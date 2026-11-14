/* ============================================================
   存储层 —— 统一使用 chrome.storage.local 的 mcData
   ============================================================ */

const MCStore = (() => {
  const KEY = 'mcData';
  const HOTBAR_SIZE = 9;
  const MAX_HISTORY = 8;

  const SEARCH_ENGINES = [
    { id: 'google', name: 'Google', url: 'https://www.google.com/search?q=' },
    { id: 'bing', name: 'Bing', url: 'https://www.bing.com/search?q=' },
    { id: 'duckduckgo', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
    { id: 'baidu', name: 'Baidu', url: 'https://www.baidu.com/s?wd=' },
    { id: '360', name: '360', url: 'https://www.so.com/s?q=' },
    { id: 'sogou', name: 'Sogou', url: 'https://www.sogou.com/web?query=' },
    { id: 'startpage', name: 'Startpage', url: 'https://www.startpage.com/sp/search?query=' },
    { id: 'brave', name: 'Brave', url: 'https://search.brave.com/search?q=' }
  ];

  const hasChromeStorage =
    typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;

  function makeDefaults() {
    return {
      version: 1,
      language: mcDetectLang(),
      playerName: '',
      wallpaper: { type: 'default', src: '', sound: false, volume: 30 },
      searchEngine: 'bing',
      searchHistory: [],
      categories: [],
      activeCategoryId: null,
      hotbar: new Array(HOTBAR_SIZE).fill(null)
    };
  }

  function normalize(raw) {
    const base = makeDefaults();
    if (!raw || typeof raw !== 'object') return base;
    const data = {
      ...base,
      ...raw,
      wallpaper: { ...base.wallpaper, ...(raw.wallpaper || {}) },
      hotbar: Array.isArray(raw.hotbar) ? raw.hotbar.slice(0, HOTBAR_SIZE) : base.hotbar,
      searchHistory: Array.isArray(raw.searchHistory) ? raw.searchHistory : [],
      categories: Array.isArray(raw.categories) ? raw.categories : []
    };
    while (data.hotbar.length < HOTBAR_SIZE) data.hotbar.push(null);
    const volume = Number(data.wallpaper.volume);
    data.wallpaper.volume = Number.isFinite(volume) ? Math.min(100, Math.max(0, Math.round(volume))) : 30;
    if (!MC_LANGS.some((l) => l.id === data.language)) data.language = base.language;
    if (!SEARCH_ENGINES.some((e) => e.id === data.searchEngine)) data.searchEngine = 'bing';
    data.categories = data.categories.filter((c) => c && c.id).map((c) => ({
      id: c.id,
      name: String(c.name || 'Category'),
      icon: typeof c.icon === 'string' ? c.icon : '',
      items: Array.isArray(c.items) ? c.items.filter((i) => i && i.id).map((i) => ({
        id: i.id,
        name: String(i.name || 'Widget'),
        url: String(i.url || ''),
        icon: typeof i.icon === 'string' ? i.icon : ''
      })) : []
    }));
    if (!data.categories.some((c) => c.id === data.activeCategoryId)) {
      data.activeCategoryId = data.categories.length ? data.categories[0].id : null;
    }
    return data;
  }

  function load() {
    return new Promise((resolve) => {
      if (hasChromeStorage) {
        chrome.storage.local.get(KEY, (res) => resolve(normalize(res && res[KEY])));
      } else {
        let raw = null;
        try {
          raw = JSON.parse(localStorage.getItem(KEY) || 'null');
        } catch (e) {
          raw = null;
        }
        resolve(normalize(raw));
      }
    });
  }

  function save(data) {
    return new Promise((resolve) => {
      if (hasChromeStorage) {
        chrome.storage.local.set({ [KEY]: data }, () => resolve(data));
      } else {
        try {
          localStorage.setItem(KEY, JSON.stringify(data));
        } catch (err) {
          console.warn('[store] localStorage 写入失败', err);
        }
        resolve(data);
      }
    });
  }

  function reset() {
    return new Promise((resolve) => {
      if (hasChromeStorage) {
        chrome.storage.local.clear(() => resolve(makeDefaults()));
      } else {
        localStorage.removeItem(KEY);
        resolve(makeDefaults());
      }
    });
  }

  function onChange(callback) {
    if (hasChromeStorage && chrome.storage.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && changes[KEY]) callback(normalize(changes[KEY].newValue));
      });
      return;
    }
    window.addEventListener('storage', (e) => {
      if (e.key === KEY) {
        let raw = null;
        try {
          raw = JSON.parse(e.newValue || 'null');
        } catch (err) {
          raw = null;
        }
        callback(normalize(raw));
      }
    });
  }

  function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
  }

  function normalizeUrl(input) {
    let value = String(input || '').trim();
    if (!value) return null;
    if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) value = 'https://' + value;
    try {
      const u = new URL(value);
      if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
      return u.href;
    } catch (e) {
      return null;
    }
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname;
    } catch (e) {
      return '';
    }
  }

  function faviconUrl(url, size) {
    const host = hostOf(url);
    if (!host) return '';
    return 'https://www.google.com/s2/favicons?domain=' + encodeURIComponent(host) + '&sz=' + (size || 64);
  }

  function searchUrl(keyword, engineId) {
    const engine = SEARCH_ENGINES.find((e) => e.id === engineId) || SEARCH_ENGINES[0];
    return engine.url + encodeURIComponent(keyword);
  }

  function isVideoSource(src) {
    const value = String(src || '').toLowerCase().split('?')[0].split('#')[0];
    return /\.(mp4|webm|ogg|mov|m4v)$/.test(value);
  }

  function findItem(data, itemId) {
    for (const category of data.categories) {
      const item = category.items.find((i) => i.id === itemId);
      if (item) return { category, item };
    }
    return null;
  }

  function pushHistory(data, keyword) {
    const term = keyword.trim();
    if (!term) return data;
    data.searchHistory = [term]
      .concat(data.searchHistory.filter((h) => h !== term))
      .slice(0, MAX_HISTORY);
    return data;
  }

  function removeItemFromHotbar(data, itemId) {
    data.hotbar = data.hotbar.map((slot) => (slot && slot.id === itemId ? null : slot));
    return data;
  }

  return {
    KEY,
    HOTBAR_SIZE,
    MAX_HISTORY,
    SEARCH_ENGINES,
    makeDefaults,
    normalize,
    load,
    save,
    reset,
    onChange,
    uid,
    normalizeUrl,
    hostOf,
    faviconUrl,
    searchUrl,
    isVideoSource,
    findItem,
    pushHistory,
    removeItemFromHotbar
  };
})();

/* ============================================================
   壁纸媒体存储 —— 大体积文件放 IndexedDB
   localStorage / chrome.storage 只保存很小的元数据
   ============================================================ */

const MCMedia = (() => {
  const DB_NAME = 'mc-newtab-media';
  const DB_VERSION = 1;
  const STORE = 'files';
  const KEY = 'wallpaper';

  let dbPromise = null;
  let cachedUrl = '';
  let cachedBlob = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB unavailable'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB unavailable'));
    });
    return dbPromise;
  }

  function invalidate() {
    if (cachedUrl) {
      URL.revokeObjectURL(cachedUrl);
      cachedUrl = '';
    }
    cachedBlob = null;
  }

  async function put(blob) {
    invalidate();
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({
        id: KEY,
        blob: blob,
        type: blob.type || '',
        savedAt: Date.now()
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error('IndexedDB write failed'));
    });
  }

  async function get() {
    if (cachedBlob) return cachedBlob;
    const db = await openDB();
    const record = await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    cachedBlob = record ? record.blob : null;
    return cachedBlob;
  }

  async function url() {
    if (cachedUrl) return cachedUrl;
    const blob = await get();
    if (!blob) return '';
    cachedUrl = URL.createObjectURL(blob);
    return cachedUrl;
  }

  async function clear() {
    invalidate();
    const db = await openDB();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  return { put, get, url, clear };
})();
