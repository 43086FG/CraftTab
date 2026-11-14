/* ============================================================
   通用 UI —— 弹窗、表单、确认框、Toast
   ============================================================ */

const MCUI = (() => {
  const DEFAULT_ICON = 'assets/missing_texture.png';

  /** 紫黑占位图的稳定标识：可被用户明确选中并保存，不随资源包 ObjectURL 失效 */
  const MISSING_ICON = 'missing_texture';

  /** 缺失贴图的最终兜底地址：固定使用项目内置静态资源，
      避免资源包重载时 ObjectURL 被 revoke 导致占位图变透明 */
  function defaultIcon() {
    return DEFAULT_ICON;
  }

  /** 把存储的图标值解析成可显示的地址 */
  function resolveIcon(value) {
    return value === MISSING_ICON ? defaultIcon() : value;
  }

  /** 把图标固定到 missing_texture：只替换一次，之后的加载失败不再触发新请求 */
  function lockFallback(img) {
    if (!img || img.dataset.mcFallback === '1') return;
    img.dataset.mcFallback = '1';
    img.src = defaultIcon();
  }

  /* ---------------- 图标候选 ---------------- */

  /* 只用 <img> 解码验证，不做内容校验；尺寸不再设下限，避免误杀 16px 小图标 */
  const ICON_MIN_SIZE = 1;
  const ICON_TIMEOUT_MS = 4000;

  /** 交给扩展后台抓页面 HTML / manifest；预览环境返回空数组 */
  function backgroundIcons(pageUrl) {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.id) {
        resolve([]);
        return;
      }
      let settled = false;
      const finish = (list) => {
        if (settled) return;
        settled = true;
        resolve(Array.isArray(list) ? list : []);
      };
      const timer = setTimeout(() => finish([]), 15000);
      try {
        chrome.runtime.sendMessage({ type: 'mc:icons', pageUrl }, (response) => {
          clearTimeout(timer);
          if (chrome.runtime.lastError) {
            finish([]);
            return;
          }
          finish(response && response.candidates);
        });
      } catch (err) {
        clearTimeout(timer);
        finish([]);
      }
    });
  }

  /**
   * 预览环境（无扩展后台）的候选：只取站点自有图标。
   * 公共图标服务的通用图不属于该站点，宁可不列，也不混进候选。
   */
  function directCandidates(url) {
    const normalized = MCStore.normalizeUrl(url);
    const host = normalized ? MCStore.hostOf(normalized) : '';
    if (!host) return [];
    return [
      'https://' + host + '/favicon.ico',
      'https://' + host + '/apple-touch-icon.png',
      'https://' + host + '/apple-touch-icon-precomposed.png'
    ];
  }

  /** 用 Image 真实解码，拿不到尺寸或失败都算无效 */
  function probeImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      let settled = false;
      const finish = (value) => {
        if (settled) return;
        settled = true;
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), ICON_TIMEOUT_MS);
      img.onload = () => {
        clearTimeout(timer);
        finish({ src: src, w: img.naturalWidth || 0, h: img.naturalHeight || 0 });
      };
      img.onerror = () => {
        clearTimeout(timer);
        finish(null);
      };
      img.src = src;
    });
  }

  function isSvgData(src) {
    return /^data:image\/svg\+xml/i.test(src);
  }

  const iconCache = new Map();

  /** 收集 → 解码验证 → 去重 → 按尺寸从大到小排序；onItem 用于边抓边显示 */
  async function discoverIcons(url, force, onItem, isStale) {
    const pageUrl = MCStore.normalizeUrl(url);
    const key = pageUrl || '';
    if (!force && iconCache.has(key)) {
      const cached = iconCache.get(key);
      if (onItem) cached.forEach((item) => onItem(item));
      return cached;
    }
    const sources = [];
    (await backgroundIcons(pageUrl)).forEach((item) => {
      const src = typeof item === 'string' ? item : item && item.src;
      if (src) sources.push(src);
    });
    /* 同时补充站内与公共图标服务，覆盖不同尺寸与不同来源 */
    directCandidates(url).forEach((src) => sources.push(src));
    const seen = new Set();
    const unique = [];
    sources.forEach((src) => {
      if (!src || seen.has(src)) return;
      seen.add(src);
      unique.push(src);
    });
    const decoded = [];
    for (const src of unique.slice(0, 12)) {
      if (isStale && isStale()) return [];
      const info = await probeImage(src);
      if (!info) continue;
      const largeEnough = isSvgData(src) || (info.w >= ICON_MIN_SIZE && info.h >= ICON_MIN_SIZE);
      if (!largeEnough) continue;
      const item = { src: src, w: info.w || ICON_MIN_SIZE, h: info.h || ICON_MIN_SIZE };
      decoded.push(item);
      if (onItem) onItem(item);
    }
    decoded.sort((a, b) => b.w * b.h - a.w * a.h);
    iconCache.set(key, decoded);
    return decoded;
  }

  /**
   * 构建图标选择网格；返回 { getIcon, refresh, invalidate }
   * invalidate 立即作废当前候选与选中（切换网址时用，防止旧站点结果回写）
   */
  function mountIconPicker(gridEl, uploadBtn, fileInput, refreshBtn, initialIcon, getUrl) {
    let selected = initialIcon || '';
    let renderToken = 0;

    const hint = document.createElement('p');
    hint.className = 'icon-hint';
    hint.hidden = true;
    gridEl.parentNode.insertBefore(hint, gridEl.nextSibling);

    function showLoading() {
      hint.hidden = true;
      gridEl.innerHTML = '';
      const cell = document.createElement('div');
      cell.className = 'icon-cell icon-loading';
      cell.setAttribute('aria-hidden', 'true');
      gridEl.appendChild(cell);
    }

    function addCell(value, src) {
      const cell = document.createElement('button');
      cell.type = 'button';
      /* MISSING_ICON 是明确的占位图选项，与「尚未选择」的空值区分开 */
      cell.className = 'icon-cell' + (value && value === selected ? ' is-selected' : '');
      cell.dataset.icon = value;
      const img = document.createElement('img');
      img.alt = '';
      img.src = src;
      img.loading = 'lazy';
      cell.classList.add('is-loading');
      img.addEventListener('load', () => cell.classList.remove('is-loading'), { once: true });
      img.addEventListener('error', () => {
        cell.classList.remove('is-loading');
        cell.dataset.failed = '1';
        lockFallback(img);
      });
      cell.appendChild(img);
      cell.addEventListener('click', () => {
        selected = value;
        gridEl.querySelectorAll('.icon-cell').forEach((node) => {
          node.classList.toggle('is-selected', node === cell);
        });
      });
      gridEl.appendChild(cell);
      return cell;
    }

    async function render(url, force) {
      const token = ++renderToken;
      const pageUrl = MCStore.normalizeUrl(url);
      hint.hidden = true;
      gridEl.innerHTML = '';
      if (selected && selected !== MISSING_ICON) addCell(selected, resolveIcon(selected));
      addCell(MISSING_ICON, defaultIcon());
      if (!pageUrl) {
        hint.textContent = t('form.iconFailed');
        hint.hidden = false;
        return;
      }
      const shown = new Set();
      const list = await discoverIcons(url, force, (item) => {
        if (token !== renderToken || shown.has(item.src) || item.src === selected) return;
        shown.add(item.src);
        addCell(item.src, item.src);
      }, () => token !== renderToken);
      if (token !== renderToken) return;
      if (!list.length) {
        hint.textContent = t('form.iconFailed');
        hint.hidden = false;
      }
    }

    /** 立即清空候选与选中，并进入加载态；随后的 render 结果若已过期会被丢弃 */
    function invalidate() {
      renderToken++;
      selected = '';
      showLoading();
    }

    async function refreshNow() {
      const pageUrl = MCStore.normalizeUrl(getUrl());
      iconCache.delete(pageUrl || '');
      await render(getUrl(), true);
    }

    refreshBtn.addEventListener('click', async () => {
      if (refreshBtn.disabled) return;
      refreshBtn.disabled = true;
      await refreshNow();
      refreshBtn.disabled = false;
    });

    uploadBtn.addEventListener('click', () => fileInput.click());
    fileInput.addEventListener('change', () => {
      const file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        selected = String(reader.result);
        const cell = addCell(selected, selected);
        cell.click();
      };
      reader.readAsDataURL(file);
    });

    render(getUrl());
    return { getIcon: () => selected, refresh: refreshNow, invalidate: invalidate };
  }

  const BTN_ICON = {
    trash: 'icon_trash',
    save: 'icon_confirm'
  };

  function btnIcon(key) {
    const name = (typeof MCPacks !== 'undefined') ? MCPacks.tex(key) : 'assets/vanilla/' + key + '.png';
    return '<img class="mc-icon" src="' + name + '" alt="">';
  }

  let root = null;
  let toastEl = null;
  let toastTimer = 0;
  let lastFocus = null;

  function ensureRefs() {
    root = document.getElementById('modalRoot');
    toastEl = document.getElementById('toast');
  }

  function isOpen() {
    return !!(root && !root.hidden);
  }

  function close() {
    if (!root) return;
    root.hidden = true;
    root.innerHTML = '';
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try {
        lastFocus.focus();
      } catch (e) {
        /* 忽略焦点恢复失败 */
      }
    }
    lastFocus = null;
  }

  function openShell(innerHtml, options) {
    ensureRefs();
    lastFocus = document.activeElement;
    root.innerHTML = innerHtml;
    root.hidden = false;
    if (options && options.dismissable) {
      root.onclick = (e) => {
        if (e.target === root) close();
      };
    } else {
      root.onclick = null;
    }
    return root.firstElementChild;
  }

  function toast(message) {
    ensureRefs();
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 1800);
  }

  /* 少数常见品牌保留原有大小写，其余按域名首字母大写推导 */
  const NAME_CASE = {
    deepseek: 'DeepSeek',
    github: 'GitHub',
    youtube: 'YouTube',
    google: 'Google'
  };

  /** 由网址推导一个可编辑的默认名称，例如 deepseek.com → DeepSeek */
  function nameFromUrl(url) {
    const host = MCStore.hostOf(url || '');
    if (!host) return '';
    const label = host.replace(/^www\./i, '').split('.')[0] || host;
    const words = label.replace(/[-_]+/g, ' ').trim().split(/\s+/).filter(Boolean);
    return words
      .map((word) => NAME_CASE[word.toLowerCase()] || (word.charAt(0).toUpperCase() + word.slice(1)))
      .join(' ');
  }

  /** 添加 / 编辑网址表单 */
  function openItemForm(opts) {
    const mode = opts.mode;
    const item = opts.item || { name: '', url: '', icon: '' };
    const isAdd = mode === 'add';

    const win = openShell(
      '<div class="mc-dark-window form-window" role="dialog" aria-modal="true">' +
        '<div class="win-head"><span class="js-title"></span></div>' +
        '<div class="form-body">' +
          '<div class="form-field">' +
            '<label class="field-label js-name-label" for="mcFieldName"></label>' +
            '<input class="mc-input" id="mcFieldName" type="text" autocomplete="off" spellcheck="false">' +
          '</div>' +
          '<div class="form-field">' +
            '<label class="field-label js-url-label" for="mcFieldUrl"></label>' +
            '<input class="mc-input" id="mcFieldUrl" type="text" autocomplete="off" spellcheck="false">' +
          '</div>' +
          '<div class="icon-block">' +
            '<span class="field-label js-icon-label"></span>' +
            '<div class="icon-grid js-icon-grid" role="group"></div>' +
            '<div class="icon-actions">' +
              '<button type="button" class="mc-action is-gray js-icon-refresh"></button>' +
              '<button type="button" class="mc-action is-gray js-icon-upload"></button>' +
              '<input class="js-icon-file" type="file" accept="image/*" hidden>' +
            '</div>' +
          '</div>' +
          '<p class="form-error js-error" hidden></p>' +
        '</div>' +
        '<div class="form-actions">' +
          '<button type="button" class="mc-action is-red js-cancel">' + btnIcon('icon_trash') + '<span></span></button>' +
          '<button type="button" class="mc-action is-green js-save">' + btnIcon('icon_confirm') + '<span></span></button>' +
        '</div>' +
      '</div>',
      { dismissable: true }
    );

    win.querySelector('.js-title').textContent = isAdd ? t('form.addTitle') : t('form.editTitle');
    win.querySelector('.js-name-label').textContent = t('form.nameLabel');
    win.querySelector('.js-url-label').textContent = t('form.urlLabel');
    win.querySelector('.js-icon-label').textContent = t('form.iconLabel');
    win.querySelector('.js-icon-refresh').textContent = t('form.iconRefresh');
    win.querySelector('.js-icon-upload').textContent = t('form.iconUpload');
    win.querySelector('.js-cancel span').textContent = isAdd ? t('form.cancelAdd') : t('form.cancelEdit');
    win.querySelector('.js-save span').textContent = isAdd ? t('form.saveAdd') : t('form.saveEdit');

    const nameEl = win.querySelector('#mcFieldName');
    const urlEl = win.querySelector('#mcFieldUrl');
    const errEl = win.querySelector('.js-error');
    nameEl.placeholder = t('form.namePlaceholder');
    urlEl.placeholder = t('form.urlPlaceholder');
    nameEl.value = item.name || '';
    urlEl.value = item.url || '';

    const picker = mountIconPicker(
      win.querySelector('.js-icon-grid'),
      win.querySelector('.js-icon-upload'),
      win.querySelector('.js-icon-file'),
      win.querySelector('.js-icon-refresh'),
      item.icon || '',
      () => urlEl.value
    );

    const showError = (msg) => {
      errEl.textContent = msg;
      errEl.hidden = !msg;
    };

    /* 名称只由用户输入，不跟随网址自动写入；保存时为空则静默用域名兜底 */
    let lastUrl = MCStore.normalizeUrl(urlEl.value) || '';
    let iconTimer = 0;
    const syncUrlChange = () => {
      const current = MCStore.normalizeUrl(urlEl.value) || '';
      if (current === lastUrl) return;
      lastUrl = current;
      picker.invalidate();
      clearTimeout(iconTimer);
      if (!current) return;
      iconTimer = setTimeout(() => picker.refresh(), 400);
    };
    urlEl.addEventListener('input', syncUrlChange);

    const submit = () => {
      const url = MCStore.normalizeUrl(urlEl.value);
      if (!url) {
        showError(t('form.errorUrl'));
        urlEl.focus();
        return;
      }
      const name = nameEl.value.trim() || nameFromUrl(url);
      close();
      opts.onSubmit({ name: name, url: url, icon: picker.getIcon() });
    };

    win.querySelector('.js-cancel').addEventListener('click', close);
    win.querySelector('.js-save').addEventListener('click', submit);
    win.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });

    nameEl.focus();
    nameEl.select();
  }

  /** 分类新建 / 重命名 / 右键编辑（名称 + 图标） */
  function openCategoryForm(opts) {
    const mode = opts.mode || 'create';
    const heading = mode === 'create' ? t('category.createTitle') : t('widgets.renameTitle');

    const win = openShell(
      '<div class="mc-dark-window form-window" role="dialog" aria-modal="true">' +
        '<div class="win-head"><span>' + heading + '</span></div>' +
        '<div class="form-body">' +
          '<div class="form-field">' +
            '<label class="field-label js-name-label" for="mcFieldCategory"></label>' +
            '<input class="mc-input" id="mcFieldCategory" type="text" autocomplete="off" spellcheck="false">' +
          '</div>' +
          '<div class="icon-block">' +
            '<span class="field-label js-icon-label"></span>' +
            '<div class="icon-grid js-icon-grid" role="group"></div>' +
            '<div class="icon-actions">' +
              '<button type="button" class="mc-action is-gray js-icon-refresh"></button>' +
              '<button type="button" class="mc-action is-gray js-icon-upload"></button>' +
              '<input class="js-icon-file" type="file" accept="image/*" hidden>' +
            '</div>' +
          '</div>' +
          '<p class="form-error js-error" hidden></p>' +
        '</div>' +
        '<div class="form-actions">' +
          '<button type="button" class="mc-action is-red js-cancel">' + btnIcon('icon_trash') +
            '<span>' + (mode === 'create' ? t('category.cancel') : t('delete.cancel')) + '</span></button>' +
          '<button type="button" class="mc-action is-green js-save">' + btnIcon('icon_confirm') +
            '<span>' + (mode === 'create' ? t('category.save') : t('widgets.save')) + '</span></button>' +
        '</div>' +
      '</div>',
      { dismissable: true }
    );

    win.querySelector('.js-name-label').textContent = t('category.nameLabel');
    win.querySelector('.js-icon-label').textContent = t('form.iconLabel');
    win.querySelector('.js-icon-refresh').textContent = t('form.iconRefresh');
    win.querySelector('.js-icon-upload').textContent = t('form.iconUpload');

    const input = win.querySelector('#mcFieldCategory');
    input.placeholder = t('category.namePlaceholder');
    input.value = opts.name || '';

    const picker = mountIconPicker(
      win.querySelector('.js-icon-grid'),
      win.querySelector('.js-icon-upload'),
      win.querySelector('.js-icon-file'),
      win.querySelector('.js-icon-refresh'),
      opts.icon || '',
      () => ''
    );

    const submit = () => {
      const name = input.value.trim() || (mode === 'create' ? 'New Category' : (opts.name || ''));
      close();
      opts.onSubmit({ name: name, icon: picker.getIcon() });
    };

    win.querySelector('.js-cancel').addEventListener('click', close);
    win.querySelector('.js-save').addEventListener('click', submit);
    win.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });

    input.focus();
    input.select();
  }

  /** 单按钮提示窗（首次引导等） */
  function openMessage(opts) {
    const win = openShell(
      '<div class="mc-dark-window delete-window" role="dialog" aria-modal="true">' +
        '<div class="delete-title js-title"></div>' +
        '<div class="delete-text js-body"></div>' +
        '<div class="delete-actions">' +
          '<button type="button" class="mc-action is-green js-action"></button>' +
        '</div>' +
      '</div>',
      { dismissable: false }
    );

    win.querySelector('.js-title').textContent = opts.title;
    win.querySelector('.js-body').textContent = opts.body;
    const action = win.querySelector('.js-action');
    action.textContent = opts.actionLabel;
    action.addEventListener('click', () => {
      close();
      if (typeof opts.onAction === 'function') opts.onAction();
    });
    requestAnimationFrame(() => action.focus());
  }

  /** 删除 / 重置确认（无关闭叉号，按钮上下排列） */
  function openConfirm(opts) {
    const win = openShell(
      '<div class="mc-dark-window delete-window" role="dialog" aria-modal="true">' +
        '<div class="delete-title js-title"></div>' +
        '<div class="delete-text js-body"></div>' +
        '<div class="delete-actions">' +
          '<button type="button" class="mc-action is-gray js-cancel"></button>' +
          '<button type="button" class="mc-action is-red js-confirm"></button>' +
        '</div>' +
      '</div>',
      { dismissable: false }
    );

    win.querySelector('.js-title').textContent = opts.title || t('delete.title');
    win.querySelector('.js-body').textContent = opts.body;
    win.querySelector('.js-cancel').textContent = opts.cancelLabel || t('delete.cancel');
    win.querySelector('.js-confirm').textContent = opts.confirmLabel || t('delete.confirm');

    win.querySelector('.js-cancel').addEventListener('click', close);
    win.querySelector('.js-confirm').addEventListener('click', () => {
      close();
      opts.onConfirm();
    });
    requestAnimationFrame(() => win.querySelector('.js-cancel').focus());
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isOpen()) {
        e.stopImmediatePropagation();
        close();
      }
    });
  }

  return { ICON: BTN_ICON, MISSING_ICON, btnIcon, defaultIcon, resolveIcon, lockFallback, isOpen, close, toast, openItemForm, openCategoryForm, openMessage, openConfirm };
})();

/* 以 1024×768 为基准等比缩放整页（rem = --u） */
(() => {
  if (typeof document === 'undefined') return;
  const apply = () => {
    const scale = Math.max(0.5, Math.min(window.innerWidth / 1024, window.innerHeight / 768));
    document.documentElement.style.setProperty('--u', scale + 'px');
  };
  apply();
  window.addEventListener('resize', apply);
})();
