/* ============================================================
   资源包 —— 内置默认包 + 导入 .mcpack / .zip（Minecraft 基岩版结构）
   目录约定：
     manifest.json          包头（header.name/description/uuid/version）
     pack_icon.png          包标
     textures/ui/*.png      界面贴图（同名路径覆盖）
     font/main.ttf          界面字体（可选）
     texts/*.lang           语言文案（可选）
     ui/theme.json          主题变量覆盖（可选，键写 --mc-* 变量）
   导入包按列表顺序覆盖内置包，列表越靠上优先级越高。
   包体存 IndexedDB（大体积 base64 不塞 chrome.storage.local）。
   ============================================================ */

const MCPacks = (() => {
  'use strict';

  const DB_NAME = 'mc-newtab-packs';
  const DB_VERSION = 1;
  const DEFAULT_ROOT = 'packs/default/';
  const DEFAULT_PACK_ID = '__default';
  const CHANNEL_NAME = 'mc-newtab-packs';

  /* 逻辑贴图名 → 默认包内的文件名（textures/ui/<key>.png） */
  const TEXTURES = {
    btn_light: 'assets/vanilla/btn_light.png',
    btn_green: 'assets/vanilla/btn_green.png',
    btn_green_hover: 'assets/vanilla/btn_green_hover.png',
    btn_stone: 'assets/vanilla/btn_stone.png',
    btn_stone_hover: 'assets/vanilla/btn_stone_hover.png',
    btn_dialog_red: 'assets/ui/btn_dialog_red.png',
    btn_dialog_light: 'assets/ui/btn_dialog_light.png',
    indent: 'assets/vanilla/indent.png',
    indent_hover: 'assets/vanilla/indent_hover.png',
    panel_dim: 'assets/vanilla/panel_dim.png',
    panel_gray: 'assets/vanilla/panel_gray.png',
    tab_back: 'assets/vanilla/tab_back.png',
    tab_front: 'assets/vanilla/tab_front.png',
    tab_front_green: 'assets/vanilla/tab_front_green.png',
    scroll_handle: 'assets/vanilla/scroll_handle.png',
    scroll_arrow_up: 'assets/vanilla/scroll_arrow_up.png',
    scroll_arrow_down: 'assets/vanilla/scroll_arrow_down.png',
    row_hover: 'assets/vanilla/row_hover.png',
    dropdown_chevron: 'assets/vanilla/dropdown_chevron.png',
    divider_light: 'assets/vanilla/divider_light.png',
    toggle_off: 'assets/vanilla/toggle_off.png',
    toggle_off_hover: 'assets/vanilla/toggle_off_hover.png',
    toggle_on: 'assets/vanilla/toggle_on.png',
    toggle_on_hover: 'assets/vanilla/toggle_on_hover.png',
    missing_texture: 'assets/missing_texture.png',
    title: 'assets/title.png',
    plus_white: 'assets/vanilla/plus_white.png',
    icon_plus_dark: 'assets/vanilla/icon_plus_dark.png',
    icon_trash: 'assets/vanilla/icon_trash.png',
    icon_confirm: 'assets/vanilla/icon_confirm.png',
    close_x_light: 'assets/vanilla/close_x_light.png',
    magnify: 'assets/vanilla/magnify.png',
    icon_preview: 'assets/vanilla/icon_preview.png',
    icon_setting: 'assets/vanilla/icon_setting.png',
    icon_inventory: 'assets/vanilla/icon_inventory.png',
    icon_language: 'assets/vanilla/icon_language.png',
    icon_undo: 'assets/vanilla/icon_undo.png',
    icon_packs: 'assets/ui/icon_packs.png',
    checkbox_on: 'assets/checkbox_on.png',
    checkbox_off: 'assets/checkbox_off.png',
    radio_on: 'assets/vanilla/radio_on.png',
    radio_off: 'assets/vanilla/radio_off.png',
    arrow_left: 'assets/arrow_left.png',
    slot_enabled: 'assets/slot_enabled.png',
    slot_enabled_hover: 'assets/slot_enabled_hover.png',
    slider_track: 'assets/vanilla/slider_track.png',
    slider_progress: 'assets/vanilla/slider_progress.png',
    slider_thumb: 'assets/vanilla/slider_thumb.png',
    slider_thumb_hover: 'assets/vanilla/slider_thumb_hover.png'
  };

  let dbPromise = null;
  let readyPromise = null;
  let packs = [];
  let activePacks = [];
  let defaultHeader = { name: 'Default', description: 'Built-in textures, font and texts', version: [1, 0, 0] };
  let textureUrls = {};
  let iconUrls = new Map();
  let fontFace = null;
  let fontUrl = '';
  let themeKeys = [];
  let channel = null;

  /* ---------------- IndexedDB ---------------- */

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('packs.importError'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('packs')) {
          db.createObjectStore('packs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('files')) {
          const store = db.createObjectStore('files', { keyPath: 'key' });
          store.createIndex('packId', 'packId', { unique: false });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('packs.importError'));
    });
    return dbPromise;
  }

  function requestAsPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('packs.importError'));
    });
  }

  function fileKey(packId, path) {
    return packId + '\u0000' + path;
  }

  async function readAllPacks() {
    const db = await openDB();
    const store = db.transaction('packs', 'readonly').objectStore('packs');
    return requestAsPromise(store.getAll());
  }

  async function readFileBlob(packId, path) {
    const db = await openDB();
    const store = db.transaction('files', 'readonly').objectStore('files');
    const record = await requestAsPromise(store.get(fileKey(packId, path)));
    return record ? record.blob : null;
  }

  async function writePack(record, files) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['packs', 'files'], 'readwrite');
      tx.objectStore('packs').put(record);
      const filesStore = tx.objectStore('files');
      files.forEach((entry) => {
        filesStore.put({
          key: fileKey(record.id, entry.path),
          packId: record.id,
          path: entry.path,
          blob: entry.blob
        });
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('packs.importError'));
      tx.onabort = () => reject(tx.error || new Error('packs.importError'));
    });
  }

  async function deletePackRecord(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(['packs', 'files'], 'readwrite');
      tx.objectStore('packs').delete(id);
      const index = tx.objectStore('files').index('packId');
      const cursorReq = index.openCursor(IDBKeyRange.only(id));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('packs.importError'));
    });
  }

  /* ---------------- ZIP 解析（原生 DecompressionStream） ---------------- */

  function findEndOfCentralDirectory(view) {
    const length = view.byteLength;
    const start = Math.max(0, length - 66000);
    for (let offset = length - 22; offset >= start; offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) return offset;
    }
    return -1;
  }

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('packs.importError');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  async function unzip(buffer) {
    const view = new DataView(buffer);
    const eocd = findEndOfCentralDirectory(view);
    if (eocd < 0) throw new Error('packs.importError');
    const total = view.getUint16(eocd + 10, true);
    const cdOffset = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder('utf-8');
    const entries = new Map();
    let pointer = cdOffset;

    for (let index = 0; index < total; index += 1) {
      if (pointer + 46 > view.byteLength || view.getUint32(pointer, true) !== 0x02014b50) break;
      const method = view.getUint16(pointer + 10, true);
      const compressedSize = view.getUint32(pointer + 20, true);
      const nameLength = view.getUint16(pointer + 28, true);
      const extraLength = view.getUint16(pointer + 30, true);
      const commentLength = view.getUint16(pointer + 32, true);
      const localOffset = view.getUint32(pointer + 42, true);
      const name = decoder.decode(new Uint8Array(buffer, pointer + 46, nameLength));
      pointer += 46 + nameLength + extraLength + commentLength;

      if (name.endsWith('/') || name.startsWith('__MACOSX/')) continue;
      if (localOffset + 30 > view.byteLength || view.getUint32(localOffset, true) !== 0x04034b50) continue;

      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const raw = buffer.slice(dataStart, dataStart + compressedSize);

      if (method === 0) {
        entries.set(name, new Uint8Array(raw));
      } else if (method === 8) {
        entries.set(name, await inflateRaw(raw));
      }
    }
    return entries;
  }

  /* ---------------- 包解析 ---------------- */

  function normalizePath(path) {
    return String(path || '').replace(/\\/g, '/').replace(/^\.?\/+/, '').replace(/\/+$/, '');
  }

  function lowerPath(path) {
    return normalizePath(path).toLowerCase();
  }

  function normalizeVersion(version) {
    if (Array.isArray(version)) {
      return version.map((part) => Number(part) || 0).slice(0, 3);
    }
    const text = String(version || '1.0.0');
    const parts = text.split(/[.]/).map((part) => parseInt(part, 10) || 0);
    while (parts.length < 3) parts.push(0);
    return parts.slice(0, 3);
  }

  function versionText(version) {
    return normalizeVersion(version).join('.');
  }

  function mimeOf(path) {
    const ext = String(path || '').split('.').pop().toLowerCase();
    const map = {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      webp: 'image/webp',
      ttf: 'font/ttf',
      otf: 'font/otf',
      lang: 'text/plain',
      json: 'application/json',
      txt: 'text/plain',
      css: 'text/css',
      wav: 'audio/wav',
      ogg: 'audio/ogg'
    };
    return map[ext] || 'application/octet-stream';
  }

  function parseManifest(text) {
    let manifest = null;
    try {
      manifest = JSON.parse(String(text || '').replace(/^\uFEFF/, ''));
    } catch (err) {
      throw new Error('packs.badManifest');
    }
    const header = manifest && manifest.header;
    if (!header || !header.name || !header.uuid || !header.version) {
      throw new Error('packs.badManifest');
    }
    return {
      name: String(header.name),
      description: String(header.description || ''),
      uuid: String(header.uuid),
      version: normalizeVersion(header.version)
    };
  }

  function findEntry(entries, wanted) {
    const target = lowerPath(wanted);
    for (const [path, bytes] of entries) {
      if (lowerPath(path) === target) return { path: normalizePath(path), bytes: bytes };
    }
    return null;
  }

  /* ---------------- 解析与合并 ---------------- */

  function buildLookup(pack) {
    const lookup = new Map();
    (pack.paths || []).forEach((path) => {
      lookup.set(lowerPath(path), path);
    });
    pack.lookup = lookup;
    return pack;
  }

  function findInPacks(path) {
    const target = lowerPath(path);
    for (const pack of activePacks) {
      const hit = pack.lookup.get(target);
      if (hit) return { pack: pack, path: hit };
    }
    return null;
  }

  async function fileFromPacks(path) {
    const found = findInPacks(path);
    if (!found) return null;
    return readFileBlob(found.pack.id, found.path);
  }

  async function readTextFile(path) {
    const blob = await fileFromPacks(path);
    if (!blob) return null;
    return blob.text();
  }

  /* ---------------- 应用 ---------------- */

  function releaseTextureUrls() {
    Object.keys(textureUrls).forEach((key) => {
      URL.revokeObjectURL(textureUrls[key]);
    });
    textureUrls = {};
  }

  async function resolveTextures() {
    const keys = Object.keys(TEXTURES);
    await Promise.all(keys.map(async (key) => {
      const blob = await fileFromPacks('textures/ui/' + key + '.png');
      if (blob) textureUrls[key] = URL.createObjectURL(blob);
    }));
  }

  function applyTextureVars() {
    const rootStyle = document.documentElement.style;
    const base = document.baseURI || window.location.href;
    Object.keys(TEXTURES).forEach((key) => {
      /* 自定义属性里的相对地址会按使用它的样式表解析，必须写成绝对地址 */
      const url = textureUrls[key] || new URL(DEFAULT_ROOT + 'textures/ui/' + key + '.png', base).href;
      rootStyle.setProperty('--tex_' + key, 'url("' + url + '")');
    });
    applyDomTextures();
  }

  /** 静态 <img data-tex="key"> 统一换成解析后的贴图 */
  function applyDomTextures(root) {
    const scope = root || document;
    scope.querySelectorAll('img[data-tex]').forEach((img) => {
      const key = img.dataset.tex;
      if (!key) return;
      const url = tex(key);
      if (url && img.getAttribute('src') !== url) img.setAttribute('src', url);
    });
  }

  function isCssVarName(name) {
    return String(name).trim().startsWith('--');
  }

  async function applyTheme() {
    const rootStyle = document.documentElement.style;
    themeKeys.forEach((key) => rootStyle.removeProperty(key));
    themeKeys = [];
    const text = await readTextFile('ui/theme.json');
    if (!text) return;
    let theme = null;
    try {
      theme = JSON.parse(text);
    } catch (err) {
      console.warn('[packs] ui/theme.json 不是合法 JSON', err);
      return;
    }
    if (!theme || typeof theme !== 'object') return;
    Object.keys(theme).forEach((key) => {
      if (!isCssVarName(key)) return;
      const value = theme[key];
      if (typeof value !== 'string' && typeof value !== 'number') return;
      rootStyle.setProperty(key, String(value));
      themeKeys.push(key);
    });
  }

  async function applyFont() {
    if (fontFace) {
      try {
        document.fonts.delete(fontFace);
      } catch (err) {
        console.warn('[packs] 移除旧字体失败', err);
      }
      fontFace = null;
    }
    if (fontUrl) {
      URL.revokeObjectURL(fontUrl);
      fontUrl = '';
    }
    const paths = ['font/main.ttf', 'font/main.otf'];
    let blob = null;
    for (const path of paths) {
      blob = await fileFromPacks(path);
      if (blob) break;
    }
    if (!blob || typeof FontFace === 'undefined') return;

    fontUrl = URL.createObjectURL(blob);
    const face = new FontFace('MC Pack Font', 'url("' + fontUrl + '")');
    try {
      await face.load();
      document.fonts.add(face);
      fontFace = face;
    } catch (err) {
      console.warn('[packs] 资源包字体加载失败，回退默认字体', err);
      URL.revokeObjectURL(fontUrl);
      fontUrl = '';
    }
  }

  async function loadDefaultHeader() {
    /* 内置包用 pack.json，避免与扩展根目录 manifest.json 重名；旧包仍兼容 manifest.json */
    const names = ['pack.json', 'manifest.json'];
    for (const name of names) {
      try {
        const response = await fetch(DEFAULT_ROOT + name, { cache: 'no-cache' });
        if (!response.ok) continue;
        const manifest = await response.json();
        if (manifest && manifest.header && manifest.header.name) {
          defaultHeader = {
            name: String(manifest.header.name),
            description: String(manifest.header.description || ''),
            version: normalizeVersion(manifest.header.version)
          };
        }
        return;
      } catch (err) {
        /* 继续尝试下一个文件名 */
      }
    }
    console.warn('[packs] 读取内置包清单失败');
  }

  async function reloadAll(silent) {
    packs = await readAllPacks();
    packs.sort((a, b) => {
      const left = Number(a.order) || 0;
      const right = Number(b.order) || 0;
      return left - right;
    });
    packs.forEach(buildLookup);
    activePacks = packs.filter((pack) => pack.enabled);

    releaseTextureUrls();
    await resolveTextures();
    applyTextureVars();
    await verifyTextureVars();
    await applyTheme();
    await applyFont();

    if (!silent) {
      broadcast();
      document.dispatchEvent(new CustomEvent('mc-packs-changed'));
    }
  }

  function broadcast() {
    if (channel) {
      try {
        channel.postMessage('reload');
      } catch (err) {
        /* 忽略频道发送失败 */
      }
    }
  }

  function init() {
    if (readyPromise) return readyPromise;
    /* 任意 <img> 加载失败都换成紫黑 missing 贴图，避免空白或浏览器坏图标 */
    document.addEventListener('error', (event) => {
      const target = event.target;
      if (!target || target.tagName !== 'IMG' || target.dataset.mcMissing === '1') return;
      target.dataset.mcMissing = '1';
      target.src = tex('missing_texture');
    }, true);
    readyPromise = (async () => {
      try {
        if (typeof BroadcastChannel !== 'undefined') {
          channel = new BroadcastChannel(CHANNEL_NAME);
          channel.onmessage = () => {
            reloadAll(true).then(() => {
              document.dispatchEvent(new CustomEvent('mc-packs-changed'));
            }).catch((err) => console.warn('[packs] 同步失败', err));
          };
        }
      } catch (err) {
        channel = null;
      }
      await loadDefaultHeader();
      await reloadAll(true);
    })().catch((err) => {
      console.warn('[packs] 初始化失败', err);
    });
    return readyPromise;
  }

  /** 同步取贴图地址：初始化前返回默认包路径，确保永远不为空 */
  function tex(key) {
    if (textureUrls[key]) return textureUrls[key];
    if (TEXTURES[key]) return DEFAULT_ROOT + 'textures/ui/' + key + '.png';
    return DEFAULT_ROOT + 'textures/ui/missing_texture.png';
  }

  /** 缺失贴图的最终兜底地址 */
  function missingTextureUrl() {
    return textureUrls['missing_texture'] || new URL(DEFAULT_ROOT + 'textures/ui/missing_texture.png', document.baseURI).href;
  }

  const failedTextures = new Set();

  function probeTexture(url) {
    return new Promise((resolve) => {
      const img = new Image();
      let settled = false;
      const finish = (ok) => {
        if (settled) return;
        settled = true;
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), 5000);
      img.onload = () => {
        clearTimeout(timer);
        finish(true);
      };
      img.onerror = () => {
        clearTimeout(timer);
        finish(false);
      };
      img.src = url;
    });
  }

  /** 逐个验证已解析出的贴图地址，失败的回退到 missing_texture */
  async function verifyTextureVars() {
    for (const key of Object.keys(TEXTURES)) {
      if (key === 'missing_texture' || failedTextures.has(key)) continue;
      const url = textureUrls[key];
      if (!url) continue;
      const ok = await probeTexture(url);
      if (ok) continue;
      failedTextures.add(key);
      document.documentElement.style.setProperty('--tex_' + key, 'url("' + missingTextureUrl() + '")');
    }
  }

  /* ---------------- 对外操作 ---------------- */

  async function importFile(file) {
    await init();
    const buffer = await file.arrayBuffer();
    let entries = null;
    try {
      entries = await unzip(buffer);
    } catch (err) {
      throw new Error('packs.importError');
    }

    /* 用户包优先 pack.json，兼容旧包的 manifest.json */
    const manifestEntry = findEntry(entries, 'pack.json') || findEntry(entries, 'manifest.json');
    if (!manifestEntry) throw new Error('packs.badManifest');
    const header = parseManifest(new TextDecoder('utf-8').decode(manifestEntry.bytes));

    const iconEntry = findEntry(entries, 'pack_icon.png');
    const files = [];
    const paths = [];
    entries.forEach((bytes, path) => {
      const clean = normalizePath(path);
      if (!clean || clean.indexOf('..') !== -1) return;
      paths.push(clean);
      files.push({
        path: clean,
        blob: new Blob([bytes], { type: mimeOf(clean) })
      });
    });

    /* 同一 uuid 视为同一资源包，重新导入时覆盖旧版本 */
    const existing = packs.find((pack) => pack.id === header.uuid);
    if (existing) await deletePackRecord(header.uuid);

    const order = existing ? existing.order : (packs.length ? Math.max.apply(null, packs.map((p) => Number(p.order) || 0)) + 1 : 0);
    const record = {
      id: header.uuid,
      name: header.name,
      description: header.description,
      version: header.version,
      enabled: true,
      order: order,
      importedAt: Date.now(),
      fileName: file.name || 'resourcepack.mcpack',
      paths: paths,
      icon: iconEntry ? new Blob([iconEntry.bytes], { type: 'image/png' }) : null
    };

    await writePack(record, files);
    await reloadAll(false);
    return record;
  }

  async function setEnabled(id, enabled) {
    const pack = packs.find((item) => item.id === id);
    if (!pack) return;
    pack.enabled = !!enabled;
    const db = await openDB();
    const store = db.transaction('packs', 'readwrite').objectStore('packs');
    await requestAsPromise(store.put(pack));
    await reloadAll(false);
  }

  async function movePack(id, direction) {
    const index = packs.findIndex((pack) => pack.id === id);
    if (index < 0) return;
    const target = direction === 'up' ? index - 1 : index + 1;
    if (target < 0 || target >= packs.length) return;
    const swap = packs[target];
    const orderA = Number(packs[index].order) || 0;
    const orderB = Number(swap.order) || 0;
    packs[index].order = orderB;
    swap.order = orderA;
    const db = await openDB();
    const store = db.transaction('packs', 'readwrite').objectStore('packs');
    await Promise.all([
      requestAsPromise(store.put(packs[index])),
      requestAsPromise(store.put(swap))
    ]);
    await reloadAll(false);
  }

  async function removePack(id) {
    const pack = packs.find((item) => item.id === id);
    if (!pack) return;
    await deletePackRecord(id);
    const url = iconUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      iconUrls.delete(id);
    }
    await reloadAll(false);
  }

  /** 设置页列表数据：导入包 + 末尾的内置默认包 */
  function getPacks() {
    const list = packs.map((pack) => {
      let iconUrl = iconUrls.get(pack.id);
      if (!iconUrl && pack.icon) {
        iconUrl = URL.createObjectURL(pack.icon);
        iconUrls.set(pack.id, iconUrl);
      }
      return {
        id: pack.id,
        name: pack.name,
        description: pack.description,
        version: versionText(pack.version),
        enabled: !!pack.enabled,
        builtin: false,
        iconUrl: iconUrl || tex('icon_packs')
      };
    });
    list.push({
      id: DEFAULT_PACK_ID,
      name: defaultHeader.name,
      description: defaultHeader.description,
      version: versionText(defaultHeader.version),
      enabled: true,
      builtin: true,
      iconUrl: tex('icon_packs')
    });
    return list;
  }

  function onChange(callback) {
    document.addEventListener('mc-packs-changed', callback);
  }

  return {
    init,
    tex,
    applyDomTextures,
    readText: readTextFile,
    importFile,
    setEnabled,
    movePack,
    removePack,
    getPacks,
    onChange,
    reload: () => reloadAll(false)
  };
})();
