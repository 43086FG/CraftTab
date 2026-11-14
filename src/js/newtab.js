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
  const TAB_PAGE_SIZE = 4;
  let tabPage = 0;
  let tooltipTarget = null;

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
    el.historyScrollbar = document.getElementById('historyScrollbar');
    el.historyScrollThumb = document.getElementById('historyScrollThumb');
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
    el.tabPrev = document.getElementById('tabPrev');
    el.tabNext = document.getElementById('tabNext');
    el.categoryLabel = document.getElementById('inventoryCategoryLabel');
    el.tooltip = document.getElementById('slotTooltip');
    el.grid = document.getElementById('inventoryGrid');
    el.gridScrollbar = document.getElementById('gridScrollbar');
    el.gridThumb = document.getElementById('gridScrollThumb');
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
      li.draggable = true;
      li.dataset.term = term;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'history-item';
      button.textContent = term;
      button.title = term;
      button.addEventListener('click', () => performSearch(term));
      li.appendChild(button);

      li.addEventListener('dragstart', (e) => {
        historyDrag = { term: term, li: li };
        li.classList.add('is-dragging');
        e.dataTransfer.effectAllowed = 'move';
        try {
          e.dataTransfer.setData('text/plain', term);
        } catch (err) {
          /* 部分环境不允许写自定义拖拽数据 */
        }
      });
      li.addEventListener('dragend', (e) => {
        const wasOut = li.classList.contains('is-drag-out');
        li.classList.remove('is-dragging', 'is-drag-out');
        if (historyDrag && historyDrag.term === term && wasOut) removeHistoryTerm(term);
        historyDrag = null;
      });

      el.historyList.appendChild(li);
    });
    updateHistoryScrollbar();
  }

  /** 拖出列表区域并松开即删除，不弹确认也不提示 */
  function removeHistoryTerm(term) {
    const list = state.searchHistory || [];
    const index = list.indexOf(term);
    if (index === -1) return;
    list.splice(index, 1);
    persist();
    renderSearchHistory();
  }

  let historyDrag = null;

  function historyPointerOutside(x, y) {
    if (!el.historyScrollbar || !historyDrag) return true;
    const rect = el.historyScrollbar.parentNode.getBoundingClientRect();
    const pad = 6;
    return x < rect.left - pad || x > rect.right + pad || y < rect.top - pad || y > rect.bottom + pad;
  }

  function trackHistoryDrag(e) {
    if (!historyDrag) return;
    const outside = historyPointerOutside(e.clientX, e.clientY);
    historyDrag.li.classList.toggle('is-drag-out', outside);
  }

  function updateHistoryScrollbar() {
    if (!el.historyList || !el.historyScrollbar || !el.historyScrollThumb) return;
    const view = el.historyList.clientHeight;
    const content = el.historyList.scrollHeight;
    if (content <= view + 1) {
      el.historyScrollbar.hidden = true;
      return;
    }
    el.historyScrollbar.hidden = false;
    const trackH = el.historyScrollbar.clientHeight;
    const thumbH = Math.max(28, Math.round(trackH * view / content));
    const maxScroll = content - view;
    const maxTop = Math.max(0, trackH - thumbH);
    const top = maxScroll ? (el.historyList.scrollTop / maxScroll) * maxTop : 0;
    el.historyScrollThumb.style.height = thumbH + 'px';
    el.historyScrollThumb.style.top = top + 'px';
  }

  let historyScrollDrag = null;

  function bindHistoryScrollbar() {
    if (!el.historyList || !el.historyScrollbar || !el.historyScrollThumb) return;

    el.historyList.addEventListener('scroll', updateHistoryScrollbar);
    window.addEventListener('resize', updateHistoryScrollbar);

    el.historyScrollThumb.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      historyScrollDrag = {
        startY: e.clientY,
        startTop: parseFloat(el.historyScrollThumb.style.top) || 0
      };
      el.historyScrollThumb.classList.add('is-dragging');
      el.historyScrollThumb.setPointerCapture(e.pointerId);
    });

    el.historyScrollThumb.addEventListener('pointermove', (e) => {
      if (!historyScrollDrag) return;
      const trackH = el.historyScrollbar.clientHeight;
      const thumbH = el.historyScrollThumb.offsetHeight;
      const maxTop = Math.max(1, trackH - thumbH);
      const maxScroll = el.historyList.scrollHeight - el.historyList.clientHeight;
      const nextTop = Math.min(maxTop, Math.max(0, historyScrollDrag.startTop + (e.clientY - historyScrollDrag.startY)));
      el.historyList.scrollTop = (nextTop / maxTop) * maxScroll;
      updateHistoryScrollbar();
    });

    const endDrag = () => {
      if (!historyScrollDrag) return;
      historyScrollDrag = null;
      el.historyScrollThumb.classList.remove('is-dragging');
    };
    el.historyScrollThumb.addEventListener('pointerup', endDrag);
    el.historyScrollThumb.addEventListener('pointercancel', endDrag);

    el.historyScrollbar.addEventListener('pointerdown', (e) => {
      if (e.target === el.historyScrollThumb) return;
      const rect = el.historyScrollbar.getBoundingClientRect();
      const trackH = el.historyScrollbar.clientHeight;
      const thumbH = el.historyScrollThumb.offsetHeight;
      const maxTop = Math.max(1, trackH - thumbH);
      const maxScroll = el.historyList.scrollHeight - el.historyList.clientHeight;
      const target = Math.min(maxTop, Math.max(0, e.clientY - rect.top - thumbH / 2));
      el.historyList.scrollTop = (target / maxTop) * maxScroll;
      updateHistoryScrollbar();
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

  /** 组件匹配文本：组件名 + 去掉协议头的网址（避免 https:// 里的字符造成误命中） */
  function matchTexts(item) {
    const url = String(item.url || '').replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    return [String(item.name || '').toLowerCase(), url.toLowerCase()];
  }

  /** 大小写不敏感的子串匹配：至少有一个字段包含完整关键词才算命中 */
  function itemMatches(item, keyword) {
    if (!keyword) return false;
    return matchTexts(item).some((text) => text.includes(keyword));
  }

  function renderSearchMatches(query) {
    const keyword = String(query || '').trim().toLowerCase();
    el.matchList.innerHTML = '';
    if (!keyword) {
      el.searchMatches.hidden = true;
      return;
    }
    const hits = savedItems().filter((item) => itemMatches(item, keyword)).slice(0, 6);
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
      /* makeIcon 自带固定尺寸图标容器，列表行直接复用 */
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
    const index = state.categories.findIndex((category) => category.id === state.activeCategoryId);
    tabPage = index > 0 ? Math.floor(index / TAB_PAGE_SIZE) : 0;
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
    hideSlotTooltip();
    el.hotbar.classList.remove('is-drag-over');
    el.btnWidgets.focus();
  }

  function renderInventory() {
    hideSlotTooltip();
    renderTabs();
    renderGrid();
    renderHotbar();
  }

  /* 每页最多 4 个页签；超过时用左右箭头翻页，不横向滚动 */
  function renderTabs() {
    el.tabStrip.innerHTML = '';
    const pageCount = Math.max(1, Math.ceil(state.categories.length / TAB_PAGE_SIZE));
    tabPage = Math.max(0, Math.min(tabPage, pageCount - 1));
    const visible = state.categories.slice(tabPage * TAB_PAGE_SIZE, tabPage * TAB_PAGE_SIZE + TAB_PAGE_SIZE);

    visible.forEach((category) => {
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

    if (el.tabPrev) el.tabPrev.hidden = pageCount <= 1 || tabPage === 0;
    if (el.tabNext) el.tabNext.hidden = pageCount <= 1 || tabPage >= pageCount - 1;

    /* 面板右上角显示当前选中分类名，翻页 / 切换分类 / 切换语言都会重算 */
    if (el.categoryLabel) {
      const category = activeCategory();
      el.categoryLabel.textContent = category ? category.name : t('inventory.title');
    }
  }

  /* 扩展环境探测：预览页没有 chrome.* 扩展 API，只能走纯前端 <img> 链路 */
  const HAS_EXTENSION = (() => {
    try {
      return typeof chrome !== 'undefined' && !!chrome.runtime && !!chrome.runtime.id;
    } catch (err) {
      return false;
    }
  })();

  const ICON_TIMEOUT_MS = 4000;
  const ICON_BUDGET_MS = 12000;

  /* 图标加载诊断：控制台随时可查，地址栏加 ?iconDebug=1 或在控制台执行
     localStorage.setItem('mcIconDebug','1') 后，槽位右上角会显示最终来源 */
  const ICON_DEBUG = (() => {
    try {
      return location.search.indexOf('iconDebug=1') !== -1 || localStorage.getItem('mcIconDebug') === '1';
    } catch (err) {
      return false;
    }
  })();

  const iconReport = [];
  window.mcIconReport = () => iconReport.map((row) => ({
    name: row.name,
    url: row.url,
    final: row.final,
    attempts: row.attempts.map((a) => a.tag + ':' + a.result + (a.size ? '(' + a.size + ')' : '')).join(' | ')
  }));

  function shortUrl(url) {
    if (!url) return '-';
    if (/^data:/i.test(url)) return 'data:' + url.slice(5, 20) + '…';
    return url;
  }

  /** 槽位图标候选：站点 /favicon.ico 优先，公共图标服务只作兜底 */
  function iconSources(item) {
    const list = [];
    if (item.icon) list.push({ url: item.icon, tag: 'custom' });
    let origin = '';
    try {
      origin = new URL(item.url).origin + '/favicon.ico';
    } catch (err) {
      origin = '';
    }
    if (origin) list.push({ url: origin, tag: 'origin-favicon' });
    const host = MCStore.hostOf(item.url);
    if (host) {
      list.push({ url: 'https://favicon.im/' + host + '?larger=true', tag: 'favicon.im' });
      list.push({ url: 'https://favicon.yandex.net/favicon/' + host, tag: 'yandex' });
      list.push({ url: 'https://icons.duckduckgo.com/ip3/' + host + '.ico', tag: 'duckduckgo' });
      list.push({ url: MCStore.faviconUrl(item.url, 64), tag: 'google-s2' });
    }
    return list;
  }

  function setDebugBadge(img, tag) {
    if (!ICON_DEBUG) return;
    let tries = 0;
    const mount = () => {
      if (!img.parentNode) {
        if (++tries < 20) setTimeout(mount, 50);
        return;
      }
      if (img.parentNode.querySelector('.slot-debug')) return;
      const badge = document.createElement('span');
      badge.className = 'slot-debug';
      badge.textContent = tag === 'missing' ? 'missing' : tag;
      img.parentNode.appendChild(badge);
    };
    mount();
  }

  function makeIcon(item) {
    const fallback = MCUI.defaultIcon();
    const sources = iconSources(item);
    const record = { name: item.name, url: item.url, env: HAS_EXTENSION ? 'extension' : 'preview', attempts: [], final: '' };
    iconReport.push(record);

    /* 所有动态图标统一装进固定尺寸、overflow:hidden 的定位容器，
       避免绝对定位的 .slot-icon 以视口/弹窗为包含块撑破布局 */
    const frame = document.createElement('span');
    frame.className = 'icon-frame';
    frame.setAttribute('aria-hidden', 'true');

    const img = document.createElement('img');
    img.className = 'slot-icon';
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.decoding = 'async';

    let index = 0;
    let timer = 0;
    let done = false;
    const startedAt = Date.now();

    const label = '[icon] ' + (record.name || '?') + ' <' + shortUrl(record.url) + '> [' + record.env + ']';

    const current = () => record.attempts[record.attempts.length - 1];

    const nextTimeout = () => {
      const left = ICON_BUDGET_MS - (Date.now() - startedAt);
      return Math.max(1200, Math.min(ICON_TIMEOUT_MS, left));
    };

    const finish = (tag) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      record.final = tag;
      const count = record.attempts.length;
      const ok = record.attempts.filter((a) => a.result === 'ok').length;
      if (tag === 'missing') {
        console.warn(label + ' → missing（' + count + ' 个地址均失败）', record.attempts);
      } else {
        console.log(label + ' → ' + tag + '（成功 ' + ok + '/' + count + '）', record.attempts);
      }
      setDebugBadge(img, tag);
    };

    const next = (reason) => {
      if (done) return;
      clearTimeout(timer);
      const attempt = current();
      if (attempt && reason) attempt.result = reason;
      if (index >= sources.length) {
        if (img.getAttribute('src') !== fallback) img.src = fallback;
        finish('missing');
        return;
      }
      const source = sources[index++];
      record.attempts.push({ tag: source.tag, url: source.url, result: 'pending' });
      console.log(label + ' 尝试 ' + index + '/' + sources.length + ' [' + source.tag + '] ' + shortUrl(source.url));
      img.src = source.url;
      const wait = nextTimeout();
      timer = setTimeout(() => {
        const pending = current();
        if (!pending || pending.result !== 'pending') return;
        pending.result = 'timeout';
        console.warn(label + ' [' + source.tag + '] 超时 ' + wait + 'ms：' + shortUrl(source.url));
        next();
      }, wait);
    };

    img.addEventListener('load', () => {
      if (done) return;
      clearTimeout(timer);
      const attempt = current();
      if (!attempt) return;
      if (!img.naturalWidth) {
        attempt.result = 'empty';
        console.warn(label + ' [' + attempt.tag + '] 解码为空：' + shortUrl(attempt.url));
        next();
        return;
      }
      attempt.result = 'ok';
      attempt.size = img.naturalWidth + 'x' + img.naturalHeight;
      finish(attempt.tag);
    });

    img.addEventListener('error', () => {
      if (done) return;
      clearTimeout(timer);
      const attempt = current();
      if (!attempt) return;
      attempt.result = 'error';
      console.warn(label + ' [' + attempt.tag + '] 加载失败（网络/拦截/非图片）：' + shortUrl(attempt.url));
      next();
    });

    frame.appendChild(img);
    next();
    return frame;
  }

  function updateGridScrollbar() {
    if (!el.grid || !el.gridScrollbar || !el.gridThumb) return;
    const view = el.grid.clientHeight;
    const content = el.grid.scrollHeight;
    if (content <= view + 1) {
      el.gridScrollbar.hidden = true;
      return;
    }
    el.gridScrollbar.hidden = false;
    const trackH = el.gridScrollbar.clientHeight;
    const thumbH = Math.max(36, Math.round(trackH * view / content));
    const maxScroll = content - view;
    const maxTop = Math.max(0, trackH - thumbH);
    const top = maxScroll ? (el.grid.scrollTop / maxScroll) * maxTop : 0;
    el.gridThumb.style.height = thumbH + 'px';
    el.gridThumb.style.top = top + 'px';
  }

  let scrollDrag = null;

  function bindGridScrollbar() {
    if (!el.grid || !el.gridScrollbar || !el.gridThumb) return;

    el.grid.addEventListener('scroll', updateGridScrollbar);
    window.addEventListener('resize', updateGridScrollbar);

    el.gridThumb.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      scrollDrag = {
        startY: e.clientY,
        startTop: parseFloat(el.gridThumb.style.top) || 0
      };
      el.gridThumb.classList.add('is-dragging');
      el.gridThumb.setPointerCapture(e.pointerId);
    });

    el.gridThumb.addEventListener('pointermove', (e) => {
      if (!scrollDrag) return;
      const trackH = el.gridScrollbar.clientHeight;
      const thumbH = el.gridThumb.offsetHeight;
      const maxTop = Math.max(1, trackH - thumbH);
      const maxScroll = el.grid.scrollHeight - el.grid.clientHeight;
      const nextTop = Math.min(maxTop, Math.max(0, scrollDrag.startTop + (e.clientY - scrollDrag.startY)));
      el.grid.scrollTop = (nextTop / maxTop) * maxScroll;
      updateGridScrollbar();
    });

    const endDrag = () => {
      if (!scrollDrag) return;
      scrollDrag = null;
      el.gridThumb.classList.remove('is-dragging');
    };
    el.gridThumb.addEventListener('pointerup', endDrag);
    el.gridThumb.addEventListener('pointercancel', endDrag);

    el.gridScrollbar.addEventListener('pointerdown', (e) => {
      if (e.target === el.gridThumb) return;
      const rect = el.gridScrollbar.getBoundingClientRect();
      const trackH = el.gridScrollbar.clientHeight;
      const thumbH = el.gridThumb.offsetHeight;
      const maxTop = Math.max(1, trackH - thumbH);
      const maxScroll = el.grid.scrollHeight - el.grid.clientHeight;
      const target = Math.min(maxTop, Math.max(0, e.clientY - rect.top - thumbH / 2));
      el.grid.scrollTop = (target / maxTop) * maxScroll;
      updateGridScrollbar();
    });
  }

  function makeItemSlot(item, options) {
    const pocket = !!(options && options.pocket);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'slot is-filled' + (pocket ? ' is-pocket' : '');
    button.dataset.itemId = item.id;
    button.dataset.itemName = item.name;
    button.setAttribute('aria-label', item.name + ' — ' + item.url);
    button.draggable = true;
    button.appendChild(makeIcon(item));
    return button;
  }

  function showSlotTooltip(target, x, y) {
    if (!el.tooltip) return;
    const name = target.dataset.itemName || '';
    if (!name) return;
    tooltipTarget = target;
    el.tooltip.textContent = name;
    el.tooltip.hidden = false;
    moveSlotTooltip(x, y);
  }

  function moveSlotTooltip(x, y) {
    if (!el.tooltip || el.tooltip.hidden) return;
    const pad = 12;
    const offsetX = 14;
    const offsetY = 18;
    let left = x + offsetX;
    let top = y + offsetY;
    const width = el.tooltip.offsetWidth;
    const height = el.tooltip.offsetHeight;
    if (left + width + pad > window.innerWidth) left = x - width - offsetX;
    if (top + height + pad > window.innerHeight) top = y - height - offsetY;
    el.tooltip.style.left = Math.max(pad, left) + 'px';
    el.tooltip.style.top = Math.max(pad, top) + 'px';
  }

  function hideSlotTooltip() {
    tooltipTarget = null;
    if (el.tooltip) el.tooltip.hidden = true;
  }

  function bindSlotTooltips(container) {
    container.addEventListener('pointerover', (e) => {
      const slot = e.target.closest ? e.target.closest('.slot[data-item-id]') : null;
      if (!slot) return;
      showSlotTooltip(slot, e.clientX, e.clientY);
    });

    container.addEventListener('pointermove', (e) => {
      if (!tooltipTarget || el.tooltip.hidden) return;
      const slot = e.target.closest ? e.target.closest('.slot[data-item-id]') : null;
      if (slot !== tooltipTarget) {
        if (slot) showSlotTooltip(slot, e.clientX, e.clientY);
        else hideSlotTooltip();
        return;
      }
      moveSlotTooltip(e.clientX, e.clientY);
    });

    container.addEventListener('pointerout', (e) => {
      const slot = e.target.closest ? e.target.closest('.slot[data-item-id]') : null;
      if (!slot) return;
      const next = e.relatedTarget && e.relatedTarget.closest ? e.relatedTarget.closest('.slot[data-item-id]') : null;
      if (next === slot) return;
      if (next) return;
      hideSlotTooltip();
    });
  }

  function renderGrid() {
    const category = activeCategory();
    const items = category ? category.items : [];
    const query = invQuery.trim().toLowerCase();
    const filtered = query
      ? items.filter((item) => itemMatches(item, query))
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

    updateGridScrollbar();
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
        tabPage = Math.floor((state.categories.length - 1) / TAB_PAGE_SIZE);
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

    el.tabPrev?.addEventListener('click', () => {
      if (tabPage <= 0) return;
      tabPage -= 1;
      hideSlotTooltip();
      renderTabs();
    });

    el.tabNext?.addEventListener('click', () => {
      const pageCount = Math.ceil(state.categories.length / TAB_PAGE_SIZE);
      if (tabPage >= pageCount - 1) return;
      tabPage += 1;
      hideSlotTooltip();
      renderTabs();
    });

    bindSlotTooltips(el.grid);
    bindSlotTooltips(el.hotbar);
    bindGridScrollbar();
    bindHistoryScrollbar();
    document.addEventListener('dragover', trackHistoryDrag);
    document.addEventListener('dragend', () => {
      historyDrag = null;
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
