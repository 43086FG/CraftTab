/* ============================================================
   设置页逻辑 —— 壁纸 / 通用 / 小组件 / 语言 / 重置与备份
   ============================================================ */

(() => {
  'use strict';

  const MODULES = ['general', 'wallpaper', 'language', 'packs', 'widgets', 'reset', 'about'];
  const NAV_GROUPS = [
    { key: 'group.general', modules: ['general'] },
    { key: 'group.appearance', modules: ['wallpaper', 'language', 'packs'] },
    { key: 'group.data', modules: ['widgets', 'reset'] },
    { key: 'group.about', modules: ['about'] }
  ];
  const MAX_FILE_BYTES = 24 * 1024 * 1024;
  const DEFAULT_BG = 'assets/default-bg.jpg';

  /** 关于页显示的版本：扩展环境读 manifest，静态预览用固定值 */
  const APP_VERSION = (() => {
    try {
      if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.getManifest) {
        const info = chrome.runtime.getManifest();
        if (info && info.version) return info.version;
      }
    } catch (err) {
      /* 预览环境没有扩展 API */
    }
    return '1.0.2';
  })();

  const NAV_ICONS = {
    wallpaper: 'icon_preview',
    general: 'icon_setting',
    widgets: 'icon_inventory',
    language: 'icon_language',
    reset: 'icon_undo',
    packs: 'icon_packs',
    about: 'assets/icon_about.png'
  };

  function navIcon(id) {
    const key = NAV_ICONS[id];
    const src = key && key.indexOf('assets/') === 0
      ? key
      : ((typeof MCPacks !== 'undefined') ? MCPacks.tex(key) : 'assets/vanilla/' + key + '.png');
    return '<img class="nav-icon" src="' + src + '" alt="">';
  }

  const el = {};
  let state = null;
  let activeModule = 'general';
  let lastSavedJson = '';

  boot();

  function cacheEls() {
    el.btnBack = document.getElementById('btnBack');
    el.headTitle = document.getElementById('headTitle');
    el.navBand = document.getElementById('navBand');
    el.content = document.getElementById('content');
  }

  async function boot() {
    cacheEls();
    if (typeof MCPacks !== 'undefined') {
      await MCPacks.init();
      MCPacks.applyDomTextures();
    }
    state = await MCStore.load();
    lastSavedJson = JSON.stringify(state);
    await mcLoadLanguage(state.language);
    mcApplyStaticText();
    await migrateLegacyWallpaper();
    renderNav();
    renderContent();
    bindBaseEvents();
    watchStorage();
  }

  async function persist() {
    lastSavedJson = JSON.stringify(state);
    await MCStore.save(state);
  }

  function watchStorage() {
    MCStore.onChange(async (next) => {
      const json = JSON.stringify(next);
      if (json === lastSavedJson) return;
      lastSavedJson = json;
      const langChanged = next.language !== state.language;
      state = next;
      if (langChanged) await mcLoadLanguage(state.language);
      mcApplyStaticText();
      renderNav();
      renderContent();
    });
  }

  function bindBaseEvents() {
    el.btnBack.addEventListener('click', () => {
      window.location.href = 'newtab.html';
    });
  }

  /* ---------------- 通用构建工具 ---------------- */

  function mk(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function append(parent, ...children) {
    children.forEach((child) => {
      if (child) parent.appendChild(child);
    });
    return parent;
  }

  /** 图像开关：四态贴图随勾选/悬停切换，按钮整块可点，支持键盘聚焦 */
  function buildToggle(checked, onChange) {
    const button = mk('button', 'mc-toggle');
    button.type = 'button';
    button.setAttribute('role', 'checkbox');
    const img = document.createElement('img');
    img.alt = '';
    let on = !!checked;
    let hover = false;
    const paint = () => {
      const key = on ? (hover ? 'toggle_on_hover' : 'toggle_on') : (hover ? 'toggle_off_hover' : 'toggle_off');
      img.src = MCPacks.tex(key);
      button.setAttribute('aria-checked', on ? 'true' : 'false');
    };
    button.appendChild(img);
    button.addEventListener('mouseenter', () => {
      hover = true;
      paint();
    });
    button.addEventListener('mouseleave', () => {
      hover = false;
      paint();
    });
    button.addEventListener('focus', () => {
      hover = true;
      paint();
    });
    button.addEventListener('blur', () => {
      hover = false;
      paint();
    });
    button.addEventListener('click', () => {
      on = !on;
      paint();
      onChange(on);
    });
    paint();
    return button;
  }

  function moduleHead(title) {
    const head = mk('div', 'module-head');
    const h1 = mk('h1', 'module-title', title);
    head.appendChild(h1);
    return head;
  }

  /* ---------------- 导航 ---------------- */

  function renderNav() {
    el.navBand.innerHTML = '';
    NAV_GROUPS.forEach((group) => {
      el.navBand.appendChild(mk('div', 'nav-group', t(group.key)));
      group.modules.forEach((id) => {
        const button = mk('button', 'nav-item' + (id === activeModule ? ' is-active' : ''));
        button.type = 'button';
        button.dataset.module = id;
        button.innerHTML = navIcon(id);
        const label = mk('span', '', t('nav.' + id));
        button.appendChild(label);
        button.addEventListener('click', () => {
          if (activeModule === id) return;
          activeModule = id;
          renderNav();
          renderContent();
          el.content.scrollTop = 0;
        });
        el.navBand.appendChild(button);
      });
    });
    el.headTitle.textContent = t('nav.' + activeModule);
  }

  /** 模板式行：上方小标题 + 下方满宽控件 */
  function settingRow(label, control) {
    const row = mk('div', 'setting-row');
    row.appendChild(mk('div', 'setting-label', label));
    row.appendChild(control);
    return row;
  }

  /* ---------------- 内容分发 ---------------- */

  function renderContent() {
    el.content.innerHTML = '';
    const wrap = mk('div', 'content-inner');
    el.content.appendChild(wrap);
    const renderers = {
      wallpaper: renderWallpaper,
      general: renderGeneral,
      widgets: renderWidgets,
      language: renderLanguage,
      packs: renderPacks,
      reset: renderReset,
      about: renderAbout
    };
    (renderers[activeModule] || renderWallpaper)(wrap);
    el.headTitle.textContent = t('nav.' + activeModule);
  }

  /* ---------------- 壁纸 ---------------- */

  function wallpaperTypeLabel(wp) {
    if (wp.type === 'video') return t('wallpaper.typeVideo');
    if (wp.type === 'image') return t('wallpaper.typeImage');
    return t('wallpaper.typeDefault');
  }

  function buildPreview(wp, src) {
    const preview = mk('div', 'wallpaper-preview');
    const isVideo = wp.type === 'video';
    if (isVideo) {
      const video = document.createElement('video');
      video.src = src;
      video.loop = true;
      video.autoplay = true;
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';
      preview.appendChild(video);
      const played = video.play();
      if (played && typeof played.catch === 'function') played.catch(() => {});
    } else {
      const img = document.createElement('img');
      img.alt = '';
      img.src = src || DEFAULT_BG;
      img.addEventListener('error', () => {
        img.src = DEFAULT_BG;
      });
      preview.appendChild(img);
    }
    preview.appendChild(mk('span', 'wallpaper-badge', wallpaperTypeLabel(wp)));
    return preview;
  }

  async function wallpaperSource(wp) {
    if (wp.src && /^data:/i.test(wp.src) === false) return wp.src;
    if (wp.type === 'default') return '';
    if (!wp.src) {
      try {
        return await MCMedia.url();
      } catch (err) {
        console.warn('[wallpaper] 读取本地壁纸失败', err);
        return '';
      }
    }
    return wp.src;
  }

  async function applyWallpaperChange(type, src) {
    state.wallpaper = {
      type: type,
      src: src || '',
      sound: !!state.wallpaper.sound,
      volume: Number.isFinite(Number(state.wallpaper.volume)) ? Number(state.wallpaper.volume) : 30
    };
    await persist();
    renderContent();
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

  async function renderWallpaper(wrap) {
    const wp = state.wallpaper;
    wrap.appendChild(moduleHead(t('nav.wallpaper')));
    const src = await wallpaperSource(wp);
    wrap.appendChild(buildPreview(wp, src));

    /* 本地文件 */
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.hidden = true;
    fileInput.accept = 'image/*,video/mp4,video/webm';
    const fileRow = settingRow(t('wallpaper.localLabel'), fileInput);
    wrap.appendChild(fileRow);

    /* 网络链接 */
    const urlInput = mk('input', 'mc-input');
    urlInput.type = 'text';
    urlInput.autocomplete = 'off';
    urlInput.spellcheck = false;
    urlInput.placeholder = t('wallpaper.urlPlaceholder');
    urlInput.value = wp.src && /^https?:/i.test(wp.src) ? wp.src : '';
    wrap.appendChild(settingRow(t('wallpaper.urlLabel'), urlInput));

    /* 声音 */
    let volumeSlider = null;
    const soundRow = mk('div', 'setting-check');
    const soundToggle = buildToggle(wp.sound, (on) => {
      state.wallpaper.sound = on;
      if (volumeSlider) volumeSlider.disabled = !on;
      persist();
    });
    soundToggle.setAttribute('aria-label', t('wallpaper.soundLabel'));
    append(soundRow, soundToggle, mk('span', 'setting-check-label', t('wallpaper.soundLabel')));
    wrap.appendChild(soundRow);
    wrap.appendChild(mk('p', 'hint', t('wallpaper.soundDesc')));

    /* 音量：原版凹槽轨道 + 方形滑块，关闭声音时置灰但仍保留数值 */
    const volume = Number.isFinite(Number(wp.volume)) ? Math.min(100, Math.max(0, Number(wp.volume))) : 30;
    const volumeRow = settingRow(t('wallpaper.volumeLabel'), mk('div', 'volume-wrap'));
    const volumeWrap = volumeRow.lastChild;
    volumeSlider = document.createElement('input');
    volumeSlider.type = 'range';
    volumeSlider.min = '0';
    volumeSlider.max = '100';
    volumeSlider.step = '1';
    volumeSlider.className = 'mc-slider';
    volumeSlider.value = String(volume);
    volumeSlider.disabled = !wp.sound;
    volumeSlider.setAttribute('aria-label', t('wallpaper.volumeLabel'));
    const volumeValue = mk('span', 'volume-value', volume + '%');
    let volumeTimer = 0;
    volumeSlider.addEventListener('input', () => {
      state.wallpaper.volume = Number(volumeSlider.value);
      volumeValue.textContent = state.wallpaper.volume + '%';
      clearTimeout(volumeTimer);
      volumeTimer = setTimeout(() => persist(), 120);
    });
    append(volumeWrap, volumeSlider, volumeValue);
    wrap.appendChild(volumeRow);

    /* 操作按钮 */
    const actions = mk('div', 'settings-actions');
    const chooseBtn = mk('button', 'mc-action is-gray', t('wallpaper.chooseFile'));
    chooseBtn.type = 'button';
    chooseBtn.addEventListener('click', () => fileInput.click());

    const applyBtn = mk('button', 'mc-action is-gray', t('wallpaper.apply'));
    applyBtn.type = 'button';
    applyBtn.addEventListener('click', async () => {
      const raw = urlInput.value.trim();
      if (!raw) {
        urlInput.focus();
        return;
      }
      const url = MCStore.normalizeUrl(raw);
      if (!url) {
        MCUI.toast(t('form.errorUrl'));
        urlInput.focus();
        return;
      }
      try {
        await MCMedia.clear();
      } catch (err) {
        console.warn('[wallpaper] 清理本地文件失败', err);
      }
      applyWallpaperChange(MCStore.isVideoSource(url) ? 'video' : 'image', url);
    });

    const restore = mk('button', 'mc-action is-gray', t('wallpaper.restoreDefault'));
    restore.type = 'button';
    restore.addEventListener('click', async () => {
      try {
        await MCMedia.clear();
      } catch (err) {
        console.warn('[wallpaper] 清理本地文件失败', err);
      }
      applyWallpaperChange('default', '');
    });

    append(actions, chooseBtn, applyBtn, restore);
    wrap.appendChild(actions);
    wrap.appendChild(mk('p', 'hint', t('wallpaper.fileHint')));

    fileInput.addEventListener('change', async () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      if (file.size > MAX_FILE_BYTES) {
        MCUI.toast(t('wallpaper.fileTooLarge'));
        return;
      }
      const kind = file.type.indexOf('video') === 0 ? 'video' : 'image';
      try {
        await MCMedia.put(file);
        await applyWallpaperChange(kind, '');
        MCUI.toast(t('toast.saved'));
      } catch (err) {
        console.warn('[wallpaper] 保存文件失败', err);
        MCUI.toast(t('wallpaper.saveError'));
      }
    });
  }

  /* ---------------- 通用 ---------------- */

  function renderGeneral(wrap) {
    wrap.appendChild(moduleHead(t('nav.general')));

    const selectWrap = mk('div', 'select-wrap is-wide');
    const select = mk('select', 'mc-select');
    select.setAttribute('aria-label', t('general.searchEngine'));
    MCStore.SEARCH_ENGINES.forEach((engine) => {
      const option = document.createElement('option');
      option.value = engine.id;
      option.textContent = engine.name;
      select.appendChild(option);
    });
    select.value = state.searchEngine;
    select.addEventListener('change', () => {
      state.searchEngine = select.value;
      persist();
    });
    selectWrap.appendChild(select);

    wrap.appendChild(settingRow(t('general.searchEngine'), selectWrap));
    wrap.appendChild(mk('p', 'hint', t('general.searchEngineDesc')));

    /* 玩家名：默认取浏览器账号显示名，取不到则留空 */
    const nameInput = mk('input', 'mc-input');
    nameInput.type = 'text';
    nameInput.maxLength = 32;
    nameInput.autocomplete = 'off';
    nameInput.spellcheck = false;
    nameInput.value = state.playerName || '';
    nameInput.placeholder = t('general.playerNamePlaceholder');
    nameInput.addEventListener('change', () => {
      state.playerName = nameInput.value.trim();
      persist();
    });
    wrap.appendChild(settingRow(t('general.playerName'), nameInput));
    wrap.appendChild(mk('p', 'hint', t('general.playerNameHint')));
  }

  /* ---------------- 小组件 ---------------- */

  function removeCategory(category) {
    MCUI.openConfirm({
      title: t('delete.title'),
      body: t('delete.categoryBody'),
      cancelLabel: t('delete.cancel'),
      confirmLabel: t('delete.categoryConfirm'),
      onConfirm: () => {
        const itemIds = category.items.map((item) => item.id);
        state.categories = state.categories.filter((c) => c.id !== category.id);
        state.hotbar = state.hotbar.map((slot) => (
          slot && itemIds.indexOf(slot.id) !== -1 ? null : slot
        ));
        if (state.activeCategoryId === category.id) {
          state.activeCategoryId = state.categories.length ? state.categories[0].id : null;
        }
        persist();
        renderContent();
      }
    });
  }

    function renderWidgets(wrap) {
    wrap.appendChild(moduleHead(t('nav.widgets')));

    const panel = mk('div', 'mc-panel');
    panel.appendChild(mk('p', 'hint', t('widgets.desc')));

    const toolbar = mk('div', 'widget-toolbar');
    const newCategory = mk('button', 'mc-action is-gray', t('widgets.newCategory'));
    newCategory.type = 'button';
    newCategory.addEventListener('click', () => {
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
          persist();
          renderContent();
        }
      });
    });

    const clearHotbar = mk('button', 'mc-action is-gray', t('widgets.clearHotbar'));
    clearHotbar.type = 'button';
    clearHotbar.addEventListener('click', () => {
      state.hotbar = new Array(MCStore.HOTBAR_SIZE).fill(null);
      persist();
      renderContent();
      MCUI.toast(t('toast.saved'));
    });
    append(toolbar, newCategory, clearHotbar);
    panel.appendChild(toolbar);

    if (!state.categories.length) {
      panel.appendChild(mk('p', 'cat-empty', t('widgets.empty')));
    } else {
      const list = mk('div', 'cat-list');
      state.categories.forEach((category) => {
        const row = mk('div', 'cat-row');
        if (category.icon) {
          const iconImg = document.createElement('img');
          iconImg.className = 'cat-icon';
          iconImg.alt = '';
          iconImg.src = category.icon;
          row.appendChild(iconImg);
        }
        append(row,
          mk('span', 'cat-name', category.name),
          mk('span', 'cat-count', t('widgets.itemsCount', { n: category.items.length }))
        );

        const iconFile = document.createElement('input');
        iconFile.type = 'file';
        iconFile.accept = 'image/*';
        iconFile.hidden = true;
        iconFile.addEventListener('change', () => {
          const file = iconFile.files && iconFile.files[0];
          iconFile.value = '';
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            category.icon = String(reader.result);
            persist();
            renderContent();
          };
          reader.readAsDataURL(file);
        });
        row.appendChild(iconFile);

        const iconBtn = mk('button', 'mini-btn', t('form.iconUpload'));
        iconBtn.type = 'button';
        iconBtn.addEventListener('click', () => iconFile.click());

        const renameBtn = mk('button', 'mini-btn', t('widgets.rename'));
        renameBtn.type = 'button';
        renameBtn.addEventListener('click', () => {
          MCUI.openCategoryForm({
            mode: 'rename',
            name: category.name,
            icon: category.icon || '',
            onSubmit: (data) => {
              category.name = data.name || category.name;
              category.icon = data.icon || '';
              persist();
              renderContent();
            }
          });
        });

        const deleteBtn = mk('button', 'mini-btn is-danger', t('widgets.delete'));
        deleteBtn.type = 'button';
        deleteBtn.addEventListener('click', () => removeCategory(category));

        append(row, iconBtn, renameBtn, deleteBtn);
        list.appendChild(row);
      });
      panel.appendChild(list);
    }

    panel.appendChild(mk('p', 'hint', t('widgets.hotbarUsage', { n: state.hotbar.filter(Boolean).length })));
    wrap.appendChild(panel);
  }

  /* ---------------- 语言 ---------------- */

  async function setLanguage(id) {
    if (state.language === id) return;
    state.language = id;
    await persist();
    await mcLoadLanguage(id);
    mcApplyStaticText();
    renderNav();
    renderContent();
  }

  function renderLanguage(wrap) {
    wrap.appendChild(moduleHead(t('nav.language')));
    const currentLabel = mcLangDisplay(state.language);
    const current = mk('div', 'lang-current', t('language.current') + ': ' + currentLabel);
    wrap.appendChild(current);
    wrap.appendChild(mk('p', 'hint', t('language.desc')));

    const list = mk('div', 'lang-list mc-scroll');
    MC_LANGS.forEach((lang) => {
      const row = mk('button', 'lang-row' + (lang.id === state.language ? ' is-active' : ''));
      row.type = 'button';
      row.dataset.lang = lang.id;
      row.setAttribute('aria-pressed', lang.id === state.language ? 'true' : 'false');

      const check = mk('span', 'lang-check');
      check.setAttribute('aria-hidden', 'true');
      const checkImg = document.createElement('img');
      checkImg.alt = '';
      checkImg.src = 'assets/vanilla/' + (lang.id === state.language ? 'radio_on.png' : 'radio_off.png');
      check.appendChild(checkImg);
      row.appendChild(check);
      row.appendChild(mk('span', '', mcLangDisplay(lang.id)));

      row.addEventListener('click', () => {
        setLanguage(lang.id);
      });
      list.appendChild(row);
    });
    wrap.appendChild(list);
  }

  /* ---------------- 全局资源（资源包） ---------------- */

  async function afterPacksChange(message) {
    mcResetLangCache();
    await mcLoadLanguage(state.language);
    mcApplyStaticText();
    renderNav();
    renderContent();
    if (message) MCUI.toast(message);
  }

  function packControls(pack) {
    const controls = mk('div', 'pack-controls');
    if (pack.builtin) {
      controls.appendChild(mk('span', 'pack-badge', 'Built-in'));
      return controls;
    }

    const toggle = buildToggle(pack.enabled, async (on) => {
      toggle.disabled = true;
      await MCPacks.setEnabled(pack.id, on);
      await afterPacksChange();
    });
    toggle.title = pack.enabled ? t('packs.disable') : t('packs.enable');
    controls.appendChild(toggle);

    const up = mk('button', 'mini-btn is-arrow', '↑');
    up.type = 'button';
    up.title = t('packs.up');
    up.setAttribute('aria-label', t('packs.up'));
    up.addEventListener('click', async () => {
      await MCPacks.movePack(pack.id, 'up');
      await afterPacksChange();
    });
    controls.appendChild(up);

    const down = mk('button', 'mini-btn is-arrow', '↓');
    down.type = 'button';
    down.title = t('packs.down');
    down.setAttribute('aria-label', t('packs.down'));
    down.addEventListener('click', async () => {
      await MCPacks.movePack(pack.id, 'down');
      await afterPacksChange();
    });
    controls.appendChild(down);

    const remove = mk('button', 'mini-btn is-danger', t('packs.delete'));
    remove.type = 'button';
    remove.addEventListener('click', () => {
      MCUI.openConfirm({
        title: t('delete.title'),
        body: t('packs.deleteBody'),
        cancelLabel: t('delete.cancel'),
        confirmLabel: t('packs.delete'),
        onConfirm: async () => {
          await MCPacks.removePack(pack.id);
          await afterPacksChange(t('toast.saved'));
        }
      });
    });
    controls.appendChild(remove);

    return controls;
  }

  function buildPackRow(pack) {
    const row = mk('div', 'pack-row' + (pack.enabled ? '' : ' is-off'));
    const icon = document.createElement('img');
    icon.className = 'pack-icon';
    icon.alt = '';
    icon.src = pack.iconUrl || MCUI.defaultIcon();
    icon.addEventListener('error', () => {
      icon.src = MCUI.defaultIcon();
    });
    row.appendChild(icon);

    const info = mk('div', 'pack-info');
    info.appendChild(mk('span', 'pack-name', pack.name));
    if (pack.description) info.appendChild(mk('span', 'pack-desc', pack.description));
    info.appendChild(mk('span', 'pack-version', 'Version ' + pack.version));
    const enabled = pack.builtin ? true : !!pack.enabled;
    info.appendChild(mk('span', 'pack-state' + (enabled ? ' is-on' : ' is-off'), t(enabled ? 'packs.statusOn' : 'packs.statusOff')));
    row.appendChild(info);
    row.appendChild(packControls(pack));
    return row;
  }

  function renderPacks(wrap) {
    wrap.appendChild(moduleHead(t('nav.packs')));
    wrap.appendChild(mk('p', 'module-sub', t('packs.desc')));

    const list = mk('div', 'pack-list');
    const packs = MCPacks.getPacks();
    packs.forEach((pack) => list.appendChild(buildPackRow(pack)));
    wrap.appendChild(list);
    if (!MCPacks.getPacks().some((pack) => !pack.builtin)) {
      wrap.appendChild(mk('p', 'hint', t('packs.empty')));
    }

    const addInput = document.createElement('input');
    addInput.type = 'file';
    addInput.hidden = true;
    addInput.accept = '.mcpack,.zip,application/zip';

    const addBtn = mk('button', 'mc-action is-stone', t('packs.add'));
    addBtn.type = 'button';
    addBtn.addEventListener('click', () => addInput.click());

    addInput.addEventListener('change', async () => {
      const file = addInput.files && addInput.files[0];
      addInput.value = '';
      if (!file) return;
      /* 只接受 .mcpack 与 .zip，其余后缀直接拒绝 */
      if (!/\.(mcpack|zip)$/i.test(file.name || '')) {
        MCUI.toast(t('packs.importError'));
        return;
      }
      try {
        await MCPacks.importFile(file);
        await afterPacksChange(t('packs.imported'));
      } catch (err) {
        const code = err && err.message ? err.message : 'packs.importError';
        MCUI.toast(t(code) === code ? t('packs.importError') : t(code));
      }
    });

    const actions = mk('div', 'settings-actions');
    actions.appendChild(addBtn);
    wrap.appendChild(actions);
    wrap.appendChild(addInput);
    wrap.appendChild(mk('p', 'hint', t('packs.uploadHint')));
  }

  /* ---------------- 重置与备份 ---------------- */

  function downloadBackup() {
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    anchor.href = url;
    anchor.download = 'mc-newtab-backup-' + stamp + '.json';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 3000);
    MCUI.toast(t('reset.exportDone'));
  }

  async function importBackup(file) {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      if (!parsed || !Array.isArray(parsed.categories)) throw new Error('invalid');
      state = MCStore.normalize(parsed);
      lastSavedJson = JSON.stringify(state);
      await MCStore.save(state);
      await mcLoadLanguage(state.language);
      mcApplyStaticText();
      renderNav();
      renderContent();
      MCUI.toast(t('reset.importDone'));
    } catch (err) {
      MCUI.toast(t('reset.importError'));
    }
  }

  async function resetAll() {
    await MCStore.reset();
    state = await MCStore.load();
    lastSavedJson = JSON.stringify(state);
    await mcLoadLanguage(state.language);
    mcApplyStaticText();
    activeModule = 'wallpaper';
    renderNav();
    renderContent();
  }

  function renderReset(wrap) {
    wrap.appendChild(moduleHead(t('nav.reset')));
    wrap.appendChild(mk('p', 'module-sub', t('reset.desc')));

    const panel = mk('div', 'mc-panel');
    const danger = mk('div', 'danger-zone');
    const resetBtn = mk('button', 'mc-action is-red', t('reset.all'));
    resetBtn.type = 'button';
    resetBtn.addEventListener('click', () => {
      MCUI.openConfirm({
        title: t('delete.title'),
        body: t('reset.desc'),
        cancelLabel: t('delete.cancel'),
        confirmLabel: t('reset.all'),
        onConfirm: resetAll
      });
    });
    danger.appendChild(resetBtn);
    panel.appendChild(danger);

    panel.appendChild(mk('div', 'section-divider'));
    panel.appendChild(mk('div', 'option-label', t('reset.backup')));

    const backupGrid = mk('div', 'backup-grid');
    const exportBtn = mk('button', 'mc-action is-gray', t('reset.export'));
    exportBtn.type = 'button';
    exportBtn.addEventListener('click', downloadBackup);

    const importBtn = mk('button', 'mc-action is-gray', t('reset.import'));
    importBtn.type = 'button';
    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.hidden = true;
    importInput.accept = '.json,application/json';
    importBtn.addEventListener('click', () => importInput.click());
    importInput.addEventListener('change', () => {
      const file = importInput.files && importInput.files[0];
      importInput.value = '';
      if (file) importBackup(file);
    });

    append(backupGrid, exportBtn, importBtn);
    append(panel, backupGrid, importInput);
    wrap.appendChild(panel);
  }

  /* ---------------- 关于 ---------------- */

  function renderAbout(wrap) {
    wrap.appendChild(moduleHead(t('nav.about')));

    const panel = mk('div', 'mc-panel');

    const authorRow = mk('div', 'about-row');
    authorRow.appendChild(mk('span', 'about-label', t('about.author')));
    authorRow.appendChild(mk('span', 'about-value', '43086FG'));
    panel.appendChild(authorRow);

    const emailRow = mk('div', 'about-row');
    emailRow.appendChild(mk('span', 'about-label', t('about.email')));
    const link = document.createElement('a');
    link.className = 'about-link';
    link.href = 'mailto:fg43086@outlook.com';
    link.textContent = 'fg43086@outlook.com';
    emailRow.appendChild(link);
    panel.appendChild(emailRow);

    const versionRow = mk('div', 'about-row');
    versionRow.appendChild(mk('span', 'about-label', t('about.version')));
    versionRow.appendChild(mk('span', 'about-value', APP_VERSION));
    panel.appendChild(versionRow);

    const texturesRow = mk('div', 'about-row');
    texturesRow.appendChild(mk('span', 'about-value', t('about.texturesFrom')));
    panel.appendChild(texturesRow);

    const copyrightRow = mk('div', 'about-row');
    copyrightRow.appendChild(mk('span', 'about-value', t('about.texturesCopyright')));
    panel.appendChild(copyrightRow);

    wrap.appendChild(panel);
  }
})();
