/* ============================================================
   后台图标抓取 —— 抓页面 HTML / manifest → 候选图标 → data URL
   仅返回 content-type 为图片的内容，超时 5s，并发上限 4
   ============================================================ */

const ICON_TIMEOUT_MS = 5000;
const ICON_MAX_BYTES = 512 * 1024;
const ICON_CONCURRENCY = 4;

let running = 0;
const waiting = [];

function withLimit(task) {
  return new Promise((resolve, reject) => {
    const run = () => {
      running += 1;
      Promise.resolve()
        .then(task)
        .then((value) => {
          running -= 1;
          resolve(value);
          const next = waiting.shift();
          if (next) next();
        })
        .catch((err) => {
          running -= 1;
          reject(err);
          const next = waiting.shift();
          if (next) next();
        });
    };
    if (running >= ICON_CONCURRENCY) waiting.push(run);
    else run();
  });
}

function timedFetch(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ICON_TIMEOUT_MS);
  return fetch(url, Object.assign({}, options, { signal: controller.signal }))
    .finally(() => clearTimeout(timer));
}

function readAttr(tag, name) {
  const re = new RegExp(name + '\\s*=\\s*("([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i');
  const match = tag.match(re);
  if (!match) return '';
  return match[2] !== undefined ? match[2] : (match[3] !== undefined ? match[3] : match[4] || '');
}

function sizeHint(text) {
  if (!text) return 0;
  if (/any/i.test(text)) return 512;
  const numbers = String(text).match(/\d+/g) || [];
  let max = 0;
  for (const value of numbers) max = Math.max(max, Number(value));
  return max;
}

function toBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function parsePageIcons(html, pageUrl) {
  const icons = [];
  const manifests = [];
  const links = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of links) {
    const rel = readAttr(tag, 'rel').toLowerCase();
    const href = readAttr(tag, 'href');
    if (!href) continue;
    if (/icon/.test(rel)) {
      icons.push({ url: new URL(href, pageUrl).href, hint: sizeHint(readAttr(tag, 'sizes')) });
    } else if (rel.includes('manifest')) {
      manifests.push(new URL(href, pageUrl).href);
    }
  }
  return { icons, manifests };
}

async function manifestIcons(manifestUrl) {
  try {
    const response = await timedFetch(manifestUrl, { credentials: 'omit' });
    if (!response.ok) return [];
    const json = await response.json();
    const list = Array.isArray(json && json.icons) ? json.icons : [];
    return list
      .filter((entry) => entry && typeof entry.src === 'string')
      .map((entry) => ({
        url: new URL(entry.src, manifestUrl).href,
        hint: sizeHint(entry.sizes)
      }));
  } catch (err) {
    return [];
  }
}

async function fetchImageData(url) {
  return withLimit(async () => {
    try {
      const response = await timedFetch(url, {
        credentials: 'omit',
        referrer: url,
        headers: { Accept: 'image/*,*/*;q=0.8' }
      });
      if (!response.ok) return null;
      const type = (response.headers.get('content-type') || '').toLowerCase();
      if (!type.startsWith('image/')) return null;
      const buffer = await response.arrayBuffer();
      if (!buffer.byteLength || buffer.byteLength > ICON_MAX_BYTES) return null;
      return 'data:' + type.split(';')[0] + ';base64,' + toBase64(new Uint8Array(buffer));
    } catch (err) {
      return null;
    }
  });
}

async function collectCandidates(pageUrl) {
  let page = null;
  try {
    page = new URL(pageUrl);
  } catch (err) {
    return [];
  }
  if (!/^http(s?):$/.test(page.protocol)) return [];

  const candidates = [];
  try {
    const response = await timedFetch(page.href, {
      credentials: 'omit',
      headers: { Accept: 'text/html,*/*;q=0.8' }
    });
    if (response.ok) {
      const html = await response.text();
      const parsed = parsePageIcons(html, page.href);
      candidates.push.apply(candidates, parsed.icons);
      const fromManifest = await Promise.all(parsed.manifests.slice(0, 2).map(manifestIcons));
      fromManifest.forEach((list) => candidates.push.apply(candidates, list));
      /* 站点内声明的图标优先，尺寸大的在前 */
      const seen = new Set();
      const sorted = candidates
        .filter((item) => {
          if (seen.has(item.url)) return false;
          seen.add(item.url);
          return true;
        })
        .sort((a, b) => b.hint - a.hint);
      const validated = [];
      for (const item of sorted.slice(0, 8)) {
        const data = await fetchImageData(item.url);
        if (data) validated.push({ src: data, hint: item.hint });
      }
      if (validated.length) return validated;
    }
  } catch (err) {
    /* 页面抓取失败时继续走回退链 */
  }

  const host = page.host;
  const fallbacks = [
    page.origin + '/favicon.ico',
    'https://icons.duckduckgo.com/ip3/' + host + '.ico',
    'https://www.google.com/s2/favicons?domain=' + host + '&sz=128',
    'https://www.google.com/s2/favicons?domain=' + host + '&sz=64'
  ];
  const list = [];
  for (const url of fallbacks) {
    const data = await fetchImageData(url);
    if (data) list.push({ src: data, hint: 0 });
  }
  return list;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.type !== 'mc:icons') return false;
  collectCandidates(String(message.pageUrl || ''))
    .then((candidates) => sendResponse({ candidates }))
    .catch(() => sendResponse({ candidates: [] }));
  return true;
});
