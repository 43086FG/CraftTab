/* ============================================================
   主界面逻辑 —— 背景、搜索、物品栏、拖拽、表单
   ============================================================ */

(() => {
  'use strict';

  const DEFAULT_BG = 'assets/default-bg.jpg';

  const el = {};
  let state = null;
  let videoEl = null;
  let searchOpen = false;
  let invQuery = '';
  let drag = null;
  let lastPointer = { x: -1, y: -1 };
  let suppressClickUntil = 0;
  let lastSavedJson = '';
  let soundUnlockBound = false;
  let audioUnlocked = false;
  let bgToken = 0;

  boot();

  function cacheEls() {
    el.bgLayer = document.getElementById('bgLayer');
    el.actionStack = document.getElementById('actionStack');
    el.playerName = document.getElementById('playerName');
    el.soundHint = document.getElementById('soundHint');
    el.btnSearch = document.getElementById('btnSearch');
    el.btnSettings = document.getElementById('btnSettings');
    el.btnWidgets = document.getElementById('btnWidgets');
    el.searchPanel = document.getElementById('searchPanel');
    el.searchField = document.getElementById('searchField');
    el.historyList = document.getElementById('historyList');
    el.historyEmpty = document.getElementById('historyEmpty');
    el.btnClearHistory = document.getElementById('btnClearHistory');
    el.searchProvider = document.getElementById('searchProvider');
    el.searchMatches = document.getElementById('searchMatches');
    el.matchList = document.getElementById('matchList');
    el.inventoryOverlay = document.getElementById('inventoryOverlay');
    el.inventoryShell = document.getElementById('inventoryShell');
    el.inventoryWindow = document.getElementById('inventoryWindow');
    el.tabStrip = document.getElementById('tabStrip');
    el.btnNewCategory = document.getElementById('btnNewCategory');
    el.inventorySearch = document.getElementById('inventorySearch');
    el.btnInventoryClose = document.getElementById('btnInventoryClose');
    el.btnInventoryHelp = document.getElementById('btnInventoryHelp');
    el.categoryLabel = null;
    el.grid = document.getElementById('inventoryGrid');
    el.hotbar = document.getElementById('hotbar');
  }

  async function boot() {
    cacheEls();
    if (typeof MCPacks !== 'undefined') {
      await MCPacks.init();
      MCPacks.applyDomTextures();
      MCPacks.onChange(() => {
        if (!el.inventoryOverlay.hidden) renderInventory();
      });
    }
    state = await MCStore.load();
    lastSavedJson = JSON.stringify(state);
    await mcLoadLanguage(state.language);
    mcApplyStaticText();
    await migrateLegacyWallpaper();
    updateProvider();
    renderPlayerName();
    applyBackground();
    renderSearchHistory();
    bindEvents();
    watchStorage();
    setInventoryPlaceholder();

    /* 从其他页面返回（含 bfcache）时恢复壁纸视频播放 */
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) {
        applyBackground();
        startHeartbeat();
        evaluateLeadership();
      } else if (videoEl) {
        syncWallpaperAudio();
      }
    });
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', handlePageLeave);
    window.addEventListener('beforeunload', handlePageLeave);
    initLeader();
  }

  /* ---------------- 多标签页音频互斥（同一时刻只允许一个标签发声） ---------------- */

  const TAB_ID = Math.random().toString(36).slice(2) + Date.now().toString(36);
  const LEADER_KEY = 'mcWallpaperLeader';
  const LEASE_MS = 3000;
  let isLeader = false;
  let leaderChannel = null;
  let heartbeatTimer = 0;

  function readLeaderLease() {
    try {
      const raw = localStorage.getItem(LEADER_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (err) {
      return null;
    }
  }

  function leaseValid(lease) {
    return !!lease && Date.now() - Number(lease.ts || 0) < LEASE_MS;
  }

  function writeLeaderLease() {
    try {
      localStorage.setItem(LEADER_KEY, JSON.stringify({ id: TAB_ID, ts: Date.now() }));
    } catch (err) {
      /* 预览/隐私模式下 localStorage 不可用时，退化为单标签发声 */
    }
  }

  function startHeartbeat() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(() => {
      if (document.visibilityState === 'visible') evaluateLeadership();
    }, 1000);
  }

  function initLeader() {
    window.addEventListener('storage', (e) => {
      if (e.key !== LEADER_KEY) return;
      evaluateLeadership();
    });
    if (typeof BroadcastChannel !== 'undefined') {
      leaderChannel = new BroadcastChannel('mc-wallpaper-leader');
      leaderChannel.onmessage = () => evaluateLeadership();
    }
    startHeartbeat();
    evaluateLeadership();
  }

  function announceLeader() {
    if (leaderChannel) {
      try {
        leaderChannel.postMessage({ id: TAB_ID, ts: Date.now() });
      } catch (err) {
        /* 忽略 */
      }
    }
  }

  function evaluateLeadership() {
    const visible = document.visibilityState === 'visible';
    const lease = readLeaderLease();
    if (!visible) {
      if (lease && lease.id === TAB_ID) {
        try {
          localStorage.removeItem(LEADER_KEY);
        } catch (err) {
          /* 忽略 */
        }
        announceLeader();
      }
      setLeader(false);
      return;
    }
    if (leaseValid(lease) && lease.id !== TAB_ID) {
      setLeader(false);
      return;
    }
    writeLeaderLease();
    setLeader(true);
    announceLeader();
  }

  function setLeader(next) {
    if (isLeader === next) {
      if (next) syncWallpaperAudio();
      return;
    }
    isLeader = next;
    if (next) {
      syncWallpaperAudio();
    } else if (videoEl) {
      videoEl.muted = true;
      videoEl.pause();
    }
  }

  function handleVisibilityChange() {
    evaluateLeadership();
    if (document.visibilityState === 'visible') {
      syncWallpaperAudio();
    } else if (videoEl) {
      videoEl.muted = true;
      videoEl.pause();
    }
  }

  function handlePageLeave() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = 0;
    }
    try {
      const lease = readLeaderLease();
      if (lease && lease.id === TAB_ID) localStorage.removeItem(LEADER_KEY);
    } catch (err) {
      /* 忽略 */
    }
    announceLeader();
    setLeader(false);
    releaseMedia();
  }

  /** 释放当前视频：暂停、静音、清空 src 并 load()，任何残留实例都不再发声 */
  function releaseMedia() {
    const video = videoEl;
    videoEl = null;
    if (!video) {
      if (el.bgLayer) el.bgLayer.innerHTML = '';
      return;
    }
    video.pause();
    video.muted = true;
    video.removeAttribute('src');
    video.srcObject = null;
    try {
      video.load();
    } catch (err) {
      /* 忽略 */
    }
    video.remove();
    if (el.bgLayer) el.bgLayer.innerHTML = '';
  }

  /** 只有「可见 + 当前 leader + 声音已解锁」时才解除静音，否则保持静音 */
  function syncWallpaperAudio(play = true) {
    if (!videoEl) return;
    const wp = state.wallpaper;
    const canSound = document.visibilityState === 'visible' && isLeader && audioUnlocked;
    videoEl.volume = wallpaperVolume();
    if (wp.sound && canSound) {
      videoEl.muted = false;
      hideSoundHint();
    } else {
      videoEl.muted = true;
      if (wp.sound) showSoundHint();
    }
    if (!play) return;
    const started = videoEl.play();
    if (started && typeof started.catch === 'function') started.catch(() => {});
  }

  async function persist() {
    lastSavedJson = JSON.stringify(state);
    await MCStore.save(state);
  }

  function watchStorage() {
    MCStore.onChange(async (next) => {
      const json = JSON.stringify(next);
      if (json === lastSavedJson) return;
      const langChanged = next.language !== state.language;
      const previous = state.wallpaper;
      lastSavedJson = json;
      state = next;
      const audioOnly = previous.type === 'video'
        && next.wallpaper.type === 'video'
        && previous.src === next.wallpaper.src;
      if (langChanged) {
        await mcLoadLanguage(state.language);
      }
      mcApplyStaticText();
      updateProvider();
      if (audioOnly) {
        applyVideoAudio();
      } else {
        applyBackground();
      }
      renderPlayerName();
      renderSearchHistory();
      setInventoryPlaceholder();
      if (!el.inventoryOverlay.hidden) renderInventory();
    });
  }

  function wallpaperVolume() {
    const value = Number(state.wallpaper.volume);
    if (!Number.isFinite(value)) return 0.3;
    return Math.min(1, Math.max(0, value / 100));
  }

  function applyVideoAudio() {
    if (!videoEl) return;
    /* 声音开关关闭时，任何 video 元素一律强制静音 */
    if (!state.wallpaper.sound) {
      videoEl.muted = true;
      videoEl.volume = wallpaperVolume();
      hideSoundHint();
      return;
    }
    syncWallpaperAudio(true);
  }

  function showSoundHint() {
    if (!el.soundHint) return;
    el.soundHint.textContent = t('wallpaper.clickForSound');
    el.soundHint.hidden = false;
  }

  function hideSoundHint() {
    if (el.soundHint) el.soundHint.hidden = true;
  }

  /** 首次任意交互后解除静音，并记住本次会话已解锁 */
  function bindSoundUnlock() {
    if (soundUnlockBound) return;
    soundUnlockBound = true;
    const unlock = () => {
      audioUnlocked = true;
      if (state.wallpaper.sound) applyVideoAudio();
      hideSoundHint();
      window.removeEventListener('pointerdown', unlock, true);
      window.removeEventListener('keydown', unlock, true);
      window.removeEventListener('touchstart', unlock, true);
    };
    window.addEventListener('pointerdown', unlock, true);
    window.addEventListener('keydown', unlock, true);
    window.addEventListener('touchstart', unlock, true);
  }

  /* ---------------- 背景 ---------------- */

  /** 主界面右上角的玩家显示名（仅主界面显示，物品栏与弹窗内不出现） */
  async function resolvePlayerName() {
    if (state.playerName) return state.playerName;
    try {
      const stored = localStorage.getItem('mcPlayerName');
      if (stored) return stored;
    } catch (err) {
      console.warn('[player] 读取显示名失败', err);
    }
    if (typeof chrome !== 'undefined' && chrome.identity && chrome.identity.getProfileUserInfo) {
      try {
        const info = await new Promise((resolve) => {
          chrome.identity.getProfileUserInfo((data) => resolve(data || {}));
        });
        if (info && info.email) return String(info.email).split('@')[0];
      } catch (err) {
        console.warn('[player] 读取账号显示名失败', err);
      }
    }
    return '';
  }

  async function renderPlayerName() {
    if (!el.playerName) return;
    el.playerName.textContent = await resolvePlayerName();
  }

  /** 旧版本把文件读成 Base64 塞进 storage，这里迁移到 IndexedDB */
  async function migrateLegacyWallpaper() {
    const wp = state.wallpaper;
    if (!wp || !wp.src || !/^data:/i.test(wp.src)) return;
    try {
      const response = await fetch(wp.src);
      const blob = await response.blob();
      await MCMedia.put(blob);
      state.wallpaper = { ...wp, src: '' };
      await persist();
    } catch (err) {
      console.warn('[wallpaper] 旧壁纸迁移失败', err);
    }
  }

  function applyBackground() {
    const token = ++bgToken;
    releaseMedia();
    const wp = state.wallpaper;

    (async () => {
      let src = wp.src || '';
      if (!src && wp.type !== 'default') {
        try {
          src = await MCMedia.url();
        } catch (err) {
          console.warn('[wallpaper] 读取本地文件失败', err);
          src = '';
        }
      }
      if (token !== bgToken) return;
      if (wp.type === 'video' && src) {
        mountVideo(src);
        return;
      }
      if (wp.type === 'image' && src) {
        mountImage(src, true);
        return;
      }
      mountImage(DEFAULT_BG, false);
    })();
  }

  function mountImage(src, allowVideoFallback) {
    const img = document.createElement('img');
    img.alt = '';
    img.decoding = 'async';
    img.src = src;
    img.addEventListener('error', () => {
      if (allowVideoFallback && MCStore.isVideoSource(src)) {
        mountVideo(src);
        return;
      }
      if (src !== DEFAULT_BG) {
        img.src = DEFAULT_BG;
      }
    });
    el.bgLayer.appendChild(img);
  }

  function mountVideo(src) {
    const video = document.createElement('video');
    video.src = src;
    video.loop = true;
    video.autoplay = true;
    /* 先强制静音保证自动播放通过，播放后再按声音开关解除静音 */
    video.muted = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = 'auto';
    video.volume = wallpaperVolume();
    video.addEventListener('error', () => {
      if (src !== DEFAULT_BG) mountImage(DEFAULT_BG, false);
    });
    el.bgLayer.appendChild(video);
    videoEl = video;

    const tryPlay = () => {
      const started = video.play();
      if (started && typeof started.catch === 'function') started.catch(() => {});
    };
    video.addEventListener('loadeddata', tryPlay, { once: true });
    video.addEventListener('canplay', tryPlay, { once: true });
    video.addEventListener('loadedmetadata', tryPlay, { once: true });
    tryPlay();

    bindSoundUnlock();
    /* 统一走声音开关 + 可见性 + leader 校验，开关关闭时必定 muted */
    applyVideoAudio();
  }

  /* ---------------- 搜索 ---------------- */

  function updateProvider() {
    const engine = MCStore.SEARCH_ENGINES.find((e) => e.id === state.searchEngine);
    el.searchProvider.textContent = engine ? engine.name : '';
  }

  function setInventoryPlaceholder() {
    if (el.inventorySearch) {
      el.inventorySearch.setAttribute('placeholder', t('inventory.searchPlaceholder'));
    }
  }

  function toggleSearch(force) {
    const open = force === undefined ? !searchOpen : force;
    if (open === searchOpen) return;
    searchOpen = open;
    el.searchPanel.hidden = !open;

    if (open) {
      el.searchField.value = '';
      renderSearchMatches('');
      renderSearchHistory();
      setTimeout(() => el.searchField.focus(), 40);
    } else {
      el.btnSearch.focus();
    }
  }

  function renderSearchHistory() {
    el.historyList.innerHTML = '';
    const history = state.searchHistory || [];
    el.btnClearHistory.disabled = history.length === 0;
    el.historyEmpty.hidden = history.length > 0;

    history.forEach((term) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'history-item';
      button.textContent = term;
      button.title = term;
      button.addEventListener('click', () => performSearch(term));
      li.appendChild(button);
      el.historyList.appendChild(li);
    });
  }

  /** 汇总所有已保存的小组件（分类 + 快捷栏，按 id 去重） */
  function savedItems() {
    const map = new Map();
    state.categories.forEach((category) => {
      category.items.forEach((item) => {
        if (item && item.id && !map.has(item.id)) map.set(item.id, item);
      });
    });
    state.hotbar.forEach((item) => {
      if (item && item.id && !map.has(item.id)) map.set(item.id, item);
    });
    return Array.from(map.values());
  }

  function renderSearchMatches(query) {
    const keyword = String(query || '').trim().toLowerCase();
    el.matchList.innerHTML = '';
    if (!keyword) {
      el.searchMatches.hidden = true;
      return;
    }
    const hits = savedItems().filter((item) => (
      (item.name || '').toLowerCase().includes(keyword) ||
      (item.url || '').toLowerCase().includes(keyword)
    )).slice(0, 6);
    if (!hits.length) {
      el.searchMatches.hidden = true;
      return;
    }

    hits.forEach((item) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'match-item';
      const name = document.createElement('span');
      name.className = 'match-name';
      name.textContent = item.name;
      const host = document.createElement('span');
      host.className = 'match-host';
      host.textContent = MCStore.hostOf(item.url) || item.url;
      button.appendChild(makeIcon(item));
      button.appendChild(name);
      button.appendChild(host);
      button.addEventListener('click', () => openSavedMatch(item));
      li.appendChild(button);
      el.matchList.appendChild(li);
    });
    el.searchMatches.hidden = false;
  }

  function openSavedMatch(item) {
    const keyword = el.searchField.value.trim() || item.name;
    MCStore.pushHistory(state, keyword);
    persist();
    renderSearchHistory();
    window.location.href = item.url;
  }

  /** 判断输入是否像一个网址（含协议或域名形态） */
  function looksLikeUrl(text) {
    const value = String(text || '').trim();
    if (!value || /\s/.test(value)) return false;
    if (/^https?:\/\//i.test(value)) return true;
    if (/^localhost(:\d+)?(\/.*)?$/i.test(value)) return true;
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+(:\d+)?(\/.*)?$/i.test(value);
  }

  async function performSearch(term) {
    const keyword = String(term || '').trim();
    if (!keyword) {
      el.searchField.focus();
      return;
    }
    const directUrl = looksLikeUrl(keyword) ? MCStore.normalizeUrl(keyword) : null;
    MCStore.pushHistory(state, keyword);
    await persist();
    renderSearchHistory();
    window.location.href = directUrl || MCStore.searchUrl(keyword, state.searchEngine);
  }

  function clearHistory() {
    if (!state.searchHistory.length) return;
    state.searchHistory = [];
    persist();
    renderSearchHistory();
  }

  /* ---------------- 物品栏 ---------------- */

  function activeCategory() {
    return state.categories.find((c) => c.id === state.activeCategoryId) || state.categories[0] || null;
  }

  function openInventory() {
    if (el.playerName) el.playerName.style.visibility = 'hidden';
    invQuery = '';
    el.inventorySearch.value = '';
    el.inventoryOverlay.hidden = false;
    renderInventory();
    if (!state.categories.length) {
      setTimeout(openWelcome, 60);
    } else {
      setTimeout(() => el.inventorySearch.focus(), 60);
    }
  }

  function closeInventory() {
    if (el.playerName) el.playerName.style.visibility = '';

    el.inventoryOverlay.hidden = true;
    invQuery = '';
    el.inventorySearch.value = '';
    el.hotbar.classList.remove('is-drag-over');
    el.btnWidgets.focus();
  }

  function renderInventory() {
    renderTabs();
    renderGrid();
    renderHotbar();
  }

  function renderTabs() {
    el.tabStrip.innerHTML = '';
    state.categories.forEach((category) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'category-tab';
      button.dataset.catId = category.id;
      button.title = category.name;
      button.setAttribute('aria-label', category.name);
      if (category.id === state.activeCategoryId) button.classList.add('is-active');

      const tabIcon = document.createElement('img');
      tabIcon.alt = '';
      tabIcon.draggable = false;
      const fallback = MCUI.defaultIcon();
      tabIcon.src = category.icon || fallback;
      tabIcon.addEventListener('error', () => {
        if (tabIcon.src.indexOf(fallback) === -1) tabIcon.src = fallback;
      });
      button.appendChild(tabIcon);
      el.tabStrip.appendChild(button);
    });
  }

  function makeIcon(item) {
    const fallback = MCUI.defaultIcon();
    const src = item.icon || MCStore.faviconUrl(item.url, 64) || fallback;
    const img = document.createElement('img');
    img.className = 'slot-icon';
    img.alt = '';
    img.loading = 'lazy';
    img.referrerPolicy = 'no-referrer';
    img.src = src;
    img.addEventListener('error', () => {
      if (img.src.indexOf(fallback) === -1) img.src = fallback;
    });
    return img;
  }

  function makeItemSlot(item, options) {
    const pocket = !!(options && options.pocket);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slot is-filled' + (pocket ? ' is-pocket' : '');
    button.dataset.itemId = item.id;
    button.title = item.name + ' — ' + item.url;
    button.draggable = true;
    button.appendChild(makeIcon(item));

    const label = document.createElement('span');
    label.className = 'slot-label';
    label.textContent = item.name;
    button.appendChild(label);
    return button;
  }

  function renderGrid() {
    const category = activeCategory();
    const items = category ? category.items : [];
    const query = invQuery.trim().toLowerCase();
    const filtered = query
      ? items.filter((item) =>
          (item.name || '').toLowerCase().includes(query) ||
          (item.url || '').toLowerCase().includes(query))
      : items;

    el.grid.innerHTML = '';

    const CELLS = 153;

    filtered.forEach((item) => el.grid.appendChild(makeItemSlot(item)));

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'slot slot-add';
    add.dataset.addCell = '1';
    add.title = t('form.addTitle');
    add.setAttribute('aria-label', t('form.addTitle'));
    const plus = document.createElement('img');
    plus.src = MCPacks.tex('plus_white');
    plus.alt = '';
    add.appendChild(plus);
    el.grid.appendChild(add);

    /* 撑出 9 列 × 4 行的格子骨架，空位只留面板同色格子 */
    const occupied = filtered.length + 1;
    for (let index = occupied; index < CELLS; index += 1) {
      const empty = document.createElement('div');
      empty.className = 'slot is-empty';
      el.grid.appendChild(empty);
    }
  }

  function renderHotbar() {
    el.hotbar.innerHTML = '';
    for (let index = 0; index < MCStore.HOTBAR_SIZE; index += 1) {
      const entry = state.hotbar[index];
      if (entry) {
        const slot = makeItemSlot(entry, { pocket: true });
        slot.classList.add('is-hotbar');
        slot.dataset.slotIndex = String(index);
        el.hotbar.appendChild(slot);
      } else {
        const empty = document.createElement('div');
        empty.className = 'slot is-empty is-pocket';
        empty.dataset.slotIndex = String(index);
        el.hotbar.appendChild(empty);
      }
    }
  }

  function openWelcome() {
    MCUI.openMessage({
      title: t('inventory.welcomeTitle'),
      body: t('inventory.welcomeBody'),
      actionLabel: t('inventory.welcomeAction'),
      onAction: openNewCategory
    });
  }

  function openNewCategory() {
    MCUI.openCategoryForm({
      mode: 'create',
      onSubmit: (data) => {
        const category = {
          id: MCStore.uid(),
          name: data.name || 'New Category',
          icon: data.icon || '',
          items: []
        };
        state.categories.push(category);
        state.activeCategoryId = category.id;
        invQuery = '';
        el.inventorySearch.value = '';
        persist();
        renderInventory();
      }
    });
  }

  function openEditCategory(categoryId) {
    const category = state.categories.find((c) => c.id === categoryId);
    if (!category) return;
    MCUI.openCategoryForm({
      mode: 'rename',
      name: category.name,
      icon: category.icon || '',
      onSubmit: (data) => {
        category.name = data.name || category.name;
        category.icon = data.icon || '';
        persist();
        renderInventory();
      }
    });
  }

  function openAddItem() {
    const category = activeCategory();
    if (!category) {
      openWelcome();
      return;
    }
    MCUI.openItemForm({
      mode: 'add',
      onSubmit: (data) => {
        category.items.push({ id: MCStore.uid(), name: data.name, url: data.url, icon: data.icon || '' });
        persist();
        renderGrid();
      }
    });
  }

  function openEditItem(itemId) {
    const found = MCStore.findItem(state, itemId);
    if (!found) return;
    MCUI.openItemForm({
      mode: 'edit',
      item: found.item,
      onSubmit: (data) => {
        found.item.name = data.name;
        found.item.url = data.url;
        found.item.icon = data.icon || '';
        state.hotbar = state.hotbar.map((slot) => {
          if (!slot || slot.id !== itemId) return slot;
          return { ...slot, name: data.name, url: data.url, icon: data.icon || '' };
        });
        persist();
        renderGrid();
        renderHotbar();
      }
    });
  }

  function openUrl(item) {
    if (!item || !item.url) return;
    window.location.href = item.url;
  }

  function requestDeleteItem(itemId) {
    const found = MCStore.findItem(state, itemId);
    if (!found) return;
    MCUI.openConfirm({
      title: t('delete.title'),
      body: t('delete.body'),
      cancelLabel: t('delete.cancel'),
      confirmLabel: t('delete.confirm'),
      onConfirm: () => {
        found.category.items = found.category.items.filter((i) => i.id !== itemId);
        MCStore.removeItemFromHotbar(state, itemId);
        persist();
        renderGrid();
        renderHotbar();
      }
    });
  }

  function clearHotbarSlot(index) {
    if (!state.hotbar[index]) return;
    state.hotbar[index] = null;
    persist();
    renderHotbar();
  }

  /* ---------------- 拖拽 ---------------- */

  function isPointInsideShell(x, y) {
    if (!el.inventoryShell) return false;
    const rect = el.inventoryShell.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }

  function beginDrag(kind, payload, element, event) {
    drag = { kind: kind, handled: false, ...payload };
    lastPointer = { x: event.clientX, y: event.clientY };
    if (element) element.classList.add('is-dragging');
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', payload.itemId || 'slot-' + payload.index);
    }
  }

  function finishDrag() {
    if (!drag) return;
    const finished = drag;
    drag = null;
    el.hotbar.classList.remove('is-drag-over');
    e_clearDropMarks();
    suppressClickUntil = Date.now() + 240;
    if (finished.handled) return;

    if (isPointInsideShell(lastPointer.x, lastPointer.y)) return;

    if (finished.kind === 'grid') {
      requestDeleteItem(finished.itemId);
    } else {
      clearHotbarSlot(finished.index);
    }
  }

  function e_clearDropMarks() {
    el.grid.querySelectorAll('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
    el.hotbar.querySelectorAll('.is-drop-target').forEach((node) => node.classList.remove('is-drop-target'));
  }

  function placeOnHotbar(event, finished) {
    const slotEl = event.target.closest ? event.target.closest('.slot') : null;
    let index = slotEl ? Number(slotEl.dataset.slotIndex) : -1;
    if (!Number.isInteger(index) || index < 0) {
      index = state.hotbar.findIndex((slot) => !slot);
    }
    if (index < 0) return;

    if (finished.kind === 'grid') {
      const found = MCStore.findItem(state, finished.itemId);
      if (!found) return;
      state.hotbar[index] = {
        id: found.item.id,
        name: found.item.name,
        url: found.item.url,
        icon: found.item.icon || ''
      };
    } else {
      const source = state.hotbar[finished.index];
      if (!source) return;
      state.hotbar[index] = { ...source };
      if (index !== finished.index) state.hotbar[finished.index] = null;
    }

    finished.handled = true;
    drag = null;
    el.hotbar.classList.remove('is-drag-over');
    e_clearDropMarks();
    persist();
    renderHotbar();
  }

  /* ---------------- 事件绑定 ---------------- */

  function bindEvents() {
    el.btnSearch.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleSearch();
    });

    el.btnSettings.addEventListener('click', () => {
      window.location.href = 'settings.html';
    });

    el.btnWidgets.addEventListener('click', (e) => {
      e.stopPropagation();
      openInventory();
    });

    el.searchField.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        performSearch(el.searchField.value);
      }
    });

    el.searchField.addEventListener('input', () => {
      renderSearchMatches(el.searchField.value);
    });

    el.btnClearHistory.addEventListener('click', (e) => {
      e.stopPropagation();
      clearHistory();
    });

    document.addEventListener('click', (e) => {
      if (!searchOpen) return;
      if (el.searchPanel.contains(e.target) || el.btnSearch.contains(e.target)) return;
      toggleSearch(false);
    });

    el.btnInventoryClose.addEventListener('click', closeInventory);

    el.inventoryOverlay.addEventListener('click', (e) => {
      if (e.target === el.inventoryOverlay) closeInventory();
    });

    el.btnNewCategory.addEventListener('click', openNewCategory);

    el.tabStrip.addEventListener('click', (e) => {
      if (Date.now() < suppressClickUntil) return;
      const tab = e.target.closest('.category-tab');
      if (!tab) return;
      const id = tab.dataset.catId;
      if (id === state.activeCategoryId) return;
      state.activeCategoryId = id;
      invQuery = '';
      el.inventorySearch.value = '';
      persist();
      renderInventory();
    });

    el.tabStrip.addEventListener('contextmenu', (e) => {
      const tab = e.target.closest('.category-tab');
      if (!tab) return;
      e.preventDefault();
      openEditCategory(tab.dataset.catId);
    });

    /* 页签行超过 4 个时：滚轮横向滚动 + 按住拖动，隐藏原生滚动条 */
    el.tabStrip.addEventListener('wheel', (e) => {
      if (el.tabStrip.scrollWidth <= el.tabStrip.clientWidth) return;
      e.preventDefault();
      el.tabStrip.scrollLeft += (e.deltaY || e.deltaX);
    }, { passive: false });

    let tabDragStart = null;
    el.tabStrip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      if (el.tabStrip.scrollWidth <= el.tabStrip.clientWidth) return;
      tabDragStart = {
        x: e.clientX,
        left: el.tabStrip.scrollLeft,
        moved: false
      };
    });
    window.addEventListener('pointermove', (e) => {
      if (!tabDragStart) return;
      const delta = e.clientX - tabDragStart.x;
      if (!tabDragStart.moved && Math.abs(delta) < 4) return;
      tabDragStart.moved = true;
      el.tabStrip.classList.add('is-dragging');
      el.tabStrip.scrollLeft = tabDragStart.left - delta;
    });
    window.addEventListener('pointerup', () => {
      if (!tabDragStart) return;
      if (tabDragStart.moved) {
        suppressClickUntil = Date.now() + 240;
        el.tabStrip.classList.remove('is-dragging');
      }
      tabDragStart = null;
    });

    el.btnInventoryHelp.addEventListener('click', () => {
      MCUI.openMessage({
        title: t('inventory.welcomeTitle'),
        body: t('inventory.welcomeBody'),
        actionLabel: t('inventory.welcomeAction'),
        onAction: () => {}
      });
    });

    el.inventorySearch.addEventListener('input', () => {
      invQuery = el.inventorySearch.value;
      renderGrid();
    });

    el.grid.addEventListener('click', (e) => {
      if (Date.now() < suppressClickUntil) return;
      const addCell = e.target.closest('[data-add-cell]');
      if (addCell) {
        openAddItem();
        return;
      }
      const slot = e.target.closest('.slot[data-item-id]');
      if (!slot) return;
      const found = MCStore.findItem(state, slot.dataset.itemId);
      if (found) openUrl(found.item);
    });

    el.grid.addEventListener('contextmenu', (e) => {
      const slot = e.target.closest('.slot[data-item-id]');
      if (!slot) return;
      e.preventDefault();
      openEditItem(slot.dataset.itemId);
    });

    el.grid.addEventListener('dragstart', (e) => {
      const slot = e.target.closest('.slot[data-item-id]');
      if (!slot) {
        e.preventDefault();
        return;
      }
      beginDrag('grid', { itemId: slot.dataset.itemId }, slot, e);
    });

    el.grid.addEventListener('dragend', (e) => {
      const slot = e.target.closest('.slot');
      if (slot) slot.classList.remove('is-dragging');
      finishDrag();
    });

    el.hotbar.addEventListener('click', (e) => {
      if (Date.now() < suppressClickUntil) return;
      const slot = e.target.closest('.slot');
      if (!slot || !slot.dataset.slotIndex) return;
      const entry = state.hotbar[Number(slot.dataset.slotIndex)];
      if (entry) openUrl(entry);
    });

    el.hotbar.addEventListener('dragstart', (e) => {
      const slot = e.target.closest('.slot[data-slot-index]');
      if (!slot || !state.hotbar[Number(slot.dataset.slotIndex)]) {
        e.preventDefault();
        return;
      }
      beginDrag('hotbar', { index: Number(slot.dataset.slotIndex) }, slot, e);
    });

    el.hotbar.addEventListener('dragend', (e) => {
      const slot = e.target.closest('.slot');
      if (slot) slot.classList.remove('is-dragging');
      finishDrag();
    });

    el.hotbar.addEventListener('dragover', (e) => {
      if (!drag) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      el.hotbar.classList.add('is-drag-over');
      e_clearDropMarks();
      const slot = e.target.closest('.slot');
      if (slot) slot.classList.add('is-drop-target');
    });

    el.hotbar.addEventListener('dragleave', (e) => {
      if (e.target === el.hotbar) {
        el.hotbar.classList.remove('is-drag-over');
        e_clearDropMarks();
      }
    });

    el.hotbar.addEventListener('drop', (e) => {
      if (!drag) return;
      e.preventDefault();
      e.stopPropagation();
      lastPointer = { x: e.clientX, y: e.clientY };
      placeOnHotbar(e, drag);
    });

    document.addEventListener('dragover', (e) => {
      if (!drag) return;
      lastPointer = { x: e.clientX, y: e.clientY };
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });

    document.addEventListener('drop', (e) => {
      if (!drag) return;
      e.preventDefault();
    });

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if (MCUI.isOpen()) return;
      if (searchOpen) {
        toggleSearch(false);
        return;
      }
      if (!el.inventoryOverlay.hidden) closeInventory();
    });
  }
})();
