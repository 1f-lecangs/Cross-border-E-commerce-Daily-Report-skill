const ADAPTERS = Object.freeze({
  'cifnews-home': Object.freeze({
    url: 'https://www.cifnews.com/',
    allowedHosts: Object.freeze(['www.cifnews.com', 'cifnews.com']),
    accept: 'text/html',
    parser: parseCifnews,
  }),
  'data10100-news': Object.freeze({
    url: 'https://www.10100.com/news',
    allowedHosts: Object.freeze(['www.10100.com', '10100.com']),
    accept: 'text/html',
    parser: parseData10100,
  }),
  'ikjzd-news': Object.freeze({
    url: 'https://www.ikjzd.com/news',
    allowedHosts: Object.freeze(['www.ikjzd.com', 'ikjzd.com']),
    accept: 'text/html',
    parser: parseIkjzd,
  }),
});

function decodeEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(Number.parseInt(number, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'");
}

function plainText(value) {
  return decodeEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function attribute(attributes, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(attributes || '').match(new RegExp(`(?:^|\\s)${escaped}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'));
  return decodeEntities(match?.[1] ?? match?.[2] ?? match?.[3] ?? '');
}

function anchors(html) {
  const result = [];
  const pattern = /<a\b([^>]*)>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(String(html || ''))) !== null && result.length < 5_000) {
    result.push({
      attributes: match[1],
      href: attribute(match[1], 'href'),
      className: attribute(match[1], 'class'),
      title: attribute(match[1], 'title'),
      dataTitle: attribute(match[1], 'data-fetch-title'),
      text: plainText(match[2]),
    });
  }
  return result;
}

function allowedUrl(href, baseUrl, allowedHosts, pathPattern) {
  try {
    const url = new URL(href, baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password) return '';
    if (!allowedHosts.includes(url.hostname.toLowerCase())) return '';
    if (!pathPattern.test(url.pathname)) return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function hasChinese(value) {
  return (String(value).match(/[\u3400-\u9fff]/g) || []).length >= 4;
}

function normalizeTitle(value) {
  return plainText(value).replace(/^\d{1,2}\s+(?=[\u3400-\u9fffA-Za-z])/, '').slice(0, 300);
}

function parseCifnews(html, definition) {
  const items = new Map();
  for (const anchor of anchors(html)) {
    const url = allowedUrl(anchor.href, definition.url, definition.allowedHosts, /^\/article\/\d+\/?$/);
    const title = normalizeTitle(anchor.dataTitle || anchor.title || anchor.text);
    if (!url || title.length < 8 || !hasChinese(title) || items.has(url)) continue;
    items.set(url, { title, url, summary: '', publishedAt: null });
  }
  return [...items.values()];
}

function parseData10100(html, definition) {
  const items = new Map();
  for (const anchor of anchors(html)) {
    const url = allowedUrl(anchor.href, definition.url, definition.allowedHosts, /^\/(?:news|article)\/\d+\/?$/);
    if (!url) continue;
    const text = normalizeTitle(anchor.title || anchor.text);
    if (text.length < 8 || !hasChinese(text)) continue;
    const existing = items.get(url);
    if (/news-content/i.test(anchor.className)) {
      if (existing && !existing.summary) existing.summary = plainText(anchor.text).slice(0, 900);
      continue;
    }
    if (!existing) items.set(url, { title: text, url, summary: '', publishedAt: null });
  }
  return [...items.values()];
}

function parseIkjzd(html, definition) {
  const items = new Map();
  for (const anchor of anchors(html)) {
    const url = allowedUrl(anchor.href, definition.url, definition.allowedHosts, /^\/news\/\d+\/?$/);
    const title = normalizeTitle(anchor.title || anchor.text);
    if (!url || title.length < 8 || !hasChinese(title) || items.has(url)) continue;
    items.set(url, { title, url, summary: '', publishedAt: null });
  }
  return [...items.values()];
}

export function adapterDefinition(id) {
  const definition = ADAPTERS[String(id || '')];
  if (!definition) throw new Error(`Unsupported source adapter: ${id}`);
  return definition;
}

export function parseAdapter(id, body, source) {
  const definition = adapterDefinition(id);
  const limit = Math.max(1, Math.min(50, Number(source.maxItems) || 12));
  return definition.parser(String(body || ''), definition).slice(0, limit).map((item) => ({
    ...item,
    source: source.name,
    sourceWeight: source.weight,
    sourceType: 'adapter',
  }));
}

export function supportedAdapters() {
  return Object.keys(ADAPTERS);
}
