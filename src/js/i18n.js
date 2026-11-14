/* ============================================================
   i18n —— 读取 texts/*.lang（Minecraft .lang 格式）
   每种语言一个文件，逐行 key=value，切换语言时刷新界面
   ============================================================ */

const MC_LANGS = [
  { id: 'zh-CN', file: 'zh_CN.lang', native: '简体中文', label: '中文(简体)' },
  { id: 'zh-TW', file: 'zh_TW.lang', native: '繁體中文', label: '中文(繁體)' },
  { id: 'en', file: 'en_US.lang', native: 'English', label: 'English (United States)' },
  { id: 'ja', file: 'ja_JP.lang', native: '日本語', label: '日本語 (日本)' },
  { id: 'ko', file: 'ko_KR.lang', native: '한국어', label: '한국어 (대한민국)' },
  { id: 'es', file: 'es_ES.lang', native: 'Español', label: 'Español (España)' },
  { id: 'ru', file: 'ru_RU.lang', native: 'Русский', label: 'Русский (Россия)' },
  { id: 'fr', file: 'fr_FR.lang', native: 'Français', label: 'Français (France)' },
  { id: 'nb', file: 'nb_NO.lang', native: 'Norsk', label: 'Norsk' }
];

const MC_TEXT_DIR = 'texts/';

const mcTables = {};
const mcLangPromises = {};

let mcLang = 'en';

/** 解析 .lang 文本：忽略注释与空行，按第一个 = 拆分 */
function mcParseLang(text) {
  const table = {};
  String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) return;
      const key = trimmed.slice(0, eq).trim();
      const value = trimmed.slice(eq + 1).trim();
      if (key) table[key] = value;
    });
  return table;
}

function mcLangEntry(id) {
  return MC_LANGS.find((l) => l.id === id) || MC_LANGS.find((l) => l.id === 'en');
}

async function mcReadLangFile(file) {
  const url = MC_TEXT_DIR + file;
  let base = {};
  try {
    const response = await fetch(url, { cache: 'no-cache' });
    if (response.ok) base = mcParseLang(await response.text());
  } catch (err) {
    console.warn('[i18n]', err);
  }
  if (typeof MCPacks !== 'undefined') {
    const packed = await MCPacks.readText(url);
    if (packed !== null && packed !== undefined) {
      /* 资源包文案只覆盖它写了的键，未写的继续用内置文案 */
      return Object.assign({}, base, mcParseLang(packed));
    }
  }
  return base;
}

function mcEnsureLang(id) {
  if (!mcLangPromises[id]) {
    const entry = mcLangEntry(id);
    mcLangPromises[id] = mcReadLangFile(entry.file).catch((err) => {
      console.warn('[i18n]', err);
      return {};
    });
  }
  return mcLangPromises[id];
}

/** 资源包变化后清空语言缓存，强制重新读取 .lang */
function mcResetLangCache() {
  Object.keys(mcLangPromises).forEach((key) => delete mcLangPromises[key]);
  Object.keys(mcTables).forEach((key) => delete mcTables[key]);
}

/** 载入并切换到指定语言；英文作为缺省回退 */
async function mcLoadLanguage(lang) {
  const id = MC_LANGS.some((l) => l.id === lang) ? lang : 'en';
  const en = await mcEnsureLang('en');
  mcTables.en = en;
  if (id === 'en') {
    mcTables.en = en;
    mcSetLang('en');
    return en;
  }
  const table = await mcEnsureLang(id);
  mcTables[id] = table;
  mcSetLang(id);
  return table;
}

function mcSetLang(lang) {
  if (!MC_LANGS.some((l) => l.id === lang)) lang = 'en';
  mcLang = lang;
  document.documentElement.dataset.lang = lang;
  document.documentElement.lang = lang;
}

function t(key, vars) {
  const current = mcTables[mcLang] || {};
  const fallback = mcTables.en || {};
  let text = current[key];
  if (text === undefined || text === '') text = fallback[key];
  if (text === undefined) return key;
  if (vars) {
    Object.keys(vars).forEach((k) => {
      text = text.replace(new RegExp('\\{' + k + '\\}', 'g'), String(vars[k]));
    });
  }
  return text;
}

/** 语言列表中的显示名：母语原名 (地区)，绝不使用译名 */
function mcLangDisplay(id) {
  return mcLangEntry(id).label;
}

/** 把 DOM 中所有 data-i18n 节点按当前语言重写 */
function mcApplyStaticText(root) {
  const scope = root || document;
  scope.querySelectorAll('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n);
  });
  scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    el.setAttribute('placeholder', t(el.dataset.i18nPlaceholder));
  });
  scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const text = t(el.dataset.i18nTitle);
    el.setAttribute('title', text);
    el.setAttribute('aria-label', text);
  });
}

/** 根据浏览器语言决定默认界面语言 */
function mcDetectLang() {
  const raw = (navigator.language || 'en').toLowerCase();
  if (raw.startsWith('zh')) {
    return /tw|hk|mo|hant/.test(raw) ? 'zh-TW' : 'zh-CN';
  }
  if (raw.startsWith('ja')) return 'ja';
  if (raw.startsWith('ko')) return 'ko';
  if (raw.startsWith('es')) return 'es';
  if (raw.startsWith('ru')) return 'ru';
  if (raw.startsWith('fr')) return 'fr';
  return 'en';
}
