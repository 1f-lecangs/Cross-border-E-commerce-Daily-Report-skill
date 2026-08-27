#!/usr/bin/env node

import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import fs from 'node:fs/promises';
import { isIP } from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CONFIG = path.resolve(SCRIPT_DIR, '..', 'references', 'sources.example.json');
const MAX_RESPONSE_BYTES = 2_000_000;
const REQUEST_TIMEOUT_MS = 20_000;

function usage() {
  return `Usage: node push_daily_report.mjs [options]

Options:
  --config <file>       JSON configuration (default: bundled public example)
  --output-dir <dir>    Output directory (default: ./daily-report-output)
  --state-dir <dir>     Hash-only history directory (default: ./.daily-report-state)
  --date <YYYY-MM-DD>   Override report date
  --max-items <n>       Override configured item limit
  --fixture <file>      Use one local RSS/Atom file instead of network sources
  --ignore-age          Keep entries outside the configured lookback window
  --no-ai               Disable optional AI summarization
  --push                Publish after generating and reviewing local outputs
  --commit-history      Save selected item hashes without publishing
  --help                Show this help
`;
}

export function parseArgs(argv) {
  const options = {
    config: DEFAULT_CONFIG,
    outputDir: path.resolve('daily-report-output'),
    stateDir: path.resolve('.daily-report-state'),
    date: '',
    maxItems: null,
    fixture: '',
    ignoreAge: false,
    noAi: false,
    push: false,
    commitHistory: false,
    help: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${arg}`);
      index += 1;
      return value;
    };
    if (arg === '--config') options.config = path.resolve(take());
    else if (arg === '--output-dir') options.outputDir = path.resolve(take());
    else if (arg === '--state-dir') options.stateDir = path.resolve(take());
    else if (arg === '--date') options.date = take();
    else if (arg === '--max-items') options.maxItems = Number(take());
    else if (arg === '--fixture') options.fixture = path.resolve(take());
    else if (arg === '--ignore-age') options.ignoreAge = true;
    else if (arg === '--no-ai') options.noAi = true;
    else if (arg === '--push') options.push = true;
    else if (arg === '--commit-history') options.commitHistory = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`Unknown option: ${arg}`);
  }
  return options;
}

const clamp = (value, min, max, fallback) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, Math.trunc(number))) : fallback;
};

export function validatePublicUrl(value, label = 'URL') {
  let url;
  try { url = new URL(value); }
  catch { throw new Error(`${label} is not a valid URL`); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${label} must use HTTP or HTTPS`);
  if (url.username || url.password) throw new Error(`${label} must not contain embedded credentials`);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const blocked = host === 'localhost' || host.endsWith('.local') || host === '0.0.0.0' || host === '::1'
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host)
    || /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) throw new Error(`${label} must not target a local or private address`);
  return url;
}

function isPrivateAddress(address) {
  const normalized = address.toLowerCase();
  if (isIP(normalized) === 4) {
    return /^127\./.test(normalized) || /^10\./.test(normalized) || /^192\.168\./.test(normalized)
      || /^169\.254\./.test(normalized) || /^172\.(1[6-9]|2\d|3[01])\./.test(normalized) || normalized === '0.0.0.0';
  }
  if (isIP(normalized) === 6) {
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd')
      || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')
      || normalized.startsWith('::ffff:127.') || normalized.startsWith('::ffff:10.') || normalized.startsWith('::ffff:192.168.');
  }
  return true;
}

async function ensurePublicResolution(url, label = 'URL') {
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = isIP(host) ? [{ address: host }] : await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error(`${label} resolves to a local or private address`);
  }
}

async function fetchPublicResource(urlValue, init = {}, redirects = 0) {
  if (redirects > 4) throw new Error('too many redirects');
  const url = validatePublicUrl(urlValue);
  await ensurePublicResolution(url);
  const response = await fetch(url, { ...init, redirect: 'manual' });
  if (response.status >= 300 && response.status < 400) {
    const location = response.headers.get('location');
    if (!location) throw new Error(`redirect ${response.status} did not include a location`);
    return fetchPublicResource(new URL(location, url).href, init, redirects + 1);
  }
  return response;
}

export function normalizeConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Config must be a JSON object');
  const sources = Array.isArray(raw.sources) ? raw.sources.map((source, index) => {
    if (!source || typeof source !== 'object') throw new Error(`Source ${index + 1} must be an object`);
    const name = String(source.name || '').trim().slice(0, 100);
    if (!name) throw new Error(`Source ${index + 1} needs a name`);
    const url = validatePublicUrl(String(source.url || ''), `Source ${name}`).href;
    return { name, url, weight: clamp(source.weight, 0, 10, 1) };
  }) : [];
  if (!sources.length) throw new Error('Config must contain at least one source');
  return {
    title: String(raw.title || 'Daily Industry Brief').trim().slice(0, 160),
    timeZone: String(raw.timeZone || 'UTC'),
    maxItems: clamp(raw.maxItems, 1, 50, 12),
    lookbackHours: clamp(raw.lookbackHours, 1, 720, 96),
    includeKeywords: Array.isArray(raw.includeKeywords) ? raw.includeKeywords.map(String).map((item) => item.trim().toLowerCase()).filter(Boolean) : [],
    excludeKeywords: Array.isArray(raw.excludeKeywords) ? raw.excludeKeywords.map(String).map((item) => item.trim().toLowerCase()).filter(Boolean) : [],
    sources,
    ai: {
      enabled: Boolean(raw.ai?.enabled),
      maxItems: clamp(raw.ai?.maxItems, 1, 20, 8),
    },
    webhookType: raw.webhookType === 'feishu' ? 'feishu' : 'generic-json',
  };
}

function decodeEntities(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
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
  return decodeEntities(String(value || ''))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tagValue(block, tags) {
  for (const tag of tags) {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const match = block.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
    if (match) return match[1];
  }
  return '';
}

function itemLink(block) {
  const text = plainText(tagValue(block, ['link']));
  if (text.startsWith('http')) return text;
  const href = block.match(/<link\b[^>]*\bhref=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1] || '';
  return decodeEntities(href.trim());
}

export function parseFeed(xml, source) {
  const blocks = [
    ...(xml.match(/<item\b[\s\S]*?<\/item>/gi) || []),
    ...(xml.match(/<entry\b[\s\S]*?<\/entry>/gi) || []),
  ];
  return blocks.map((block) => {
    const title = plainText(tagValue(block, ['title']));
    const url = itemLink(block);
    const summary = plainText(tagValue(block, ['content:encoded', 'description', 'summary', 'content'])).slice(0, 900);
    const publishedRaw = plainText(tagValue(block, ['pubDate', 'published', 'updated', 'dc:date']));
    const timestamp = Date.parse(publishedRaw);
    return {
      title: title.slice(0, 300),
      url,
      summary,
      publishedAt: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null,
      source: source.name,
      sourceWeight: source.weight,
    };
  }).filter((item) => {
    if (item.title.length < 4) return false;
    try { validatePublicUrl(item.url, 'Item URL'); return true; }
    catch { return false; }
  });
}

async function fetchText(urlValue) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchPublicResource(urlValue, {
      signal: controller.signal,
      headers: { 'User-Agent': 'push-daily-report-skill/1.0', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const reader = response.body?.getReader();
    if (!reader) return '';
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) throw new Error('response exceeded size limit');
      chunks.push(value);
    }
    return new TextDecoder().decode(Buffer.concat(chunks));
  } finally {
    clearTimeout(timeout);
  }
}

function itemHash(item) {
  return crypto.createHash('sha256').update(`${item.url}\n${item.title}`).digest('hex');
}

function referenceTime(dateOverride) {
  if (!dateOverride) return Date.now();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOverride)) throw new Error('--date must use YYYY-MM-DD');
  return Date.parse(`${dateOverride}T23:59:59Z`);
}

export function filterAndRank(items, config, options = {}) {
  const history = new Set(options.history || []);
  const now = options.now ?? Date.now();
  const cutoff = now - config.lookbackHours * 3_600_000;
  const deduped = new Map();
  for (const item of items) {
    const haystack = `${item.title} ${item.summary}`.toLowerCase();
    if (config.excludeKeywords.some((keyword) => haystack.includes(keyword))) continue;
    const keywordHits = config.includeKeywords.filter((keyword) => haystack.includes(keyword)).length;
    if (config.includeKeywords.length && keywordHits === 0) continue;
    if (!options.ignoreAge && item.publishedAt && Date.parse(item.publishedAt) < cutoff) continue;
    const hash = itemHash(item);
    if (history.has(hash)) continue;
    const key = item.url.replace(/[?#].*$/, '').replace(/\/$/, '') || item.title.toLowerCase();
    const ageHours = item.publishedAt ? Math.max(0, (now - Date.parse(item.publishedAt)) / 3_600_000) : config.lookbackHours;
    const freshness = Math.max(0, 3 - ageHours / Math.max(1, config.lookbackHours / 3));
    const scored = { ...item, hash, score: Number((item.sourceWeight + keywordHits * 2 + freshness).toFixed(2)) };
    const existing = deduped.get(key);
    if (!existing || scored.score > existing.score) deduped.set(key, scored);
  }
  return [...deduped.values()]
    .sort((a, b) => b.score - a.score || String(b.publishedAt || '').localeCompare(String(a.publishedAt || '')))
    .slice(0, options.maxItems || config.maxItems);
}

async function summarizeWithAi(item) {
  const baseUrl = process.env.DAILY_REPORT_AI_BASE_URL || '';
  const apiKey = process.env.DAILY_REPORT_AI_API_KEY || '';
  const model = process.env.DAILY_REPORT_AI_MODEL || '';
  if (!baseUrl || !apiKey || !model) return null;
  const endpoint = new URL('chat/completions', `${validatePublicUrl(baseUrl, 'AI base URL').href.replace(/\/$/, '')}/`);
  await ensurePublicResolution(endpoint, 'AI endpoint');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45_000);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      redirect: 'error',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        max_tokens: 180,
        messages: [
          { role: 'system', content: 'Summarize the supplied public news item accurately in 60-100 Chinese characters. Do not invent facts, numbers, or implications.' },
          { role: 'user', content: `Title: ${item.title}\nSource summary: ${item.summary || '(none)'}` },
        ],
      }),
    });
    if (!response.ok) throw new Error(`AI HTTP ${response.status}`);
    const data = await response.json();
    return plainText(data.choices?.[0]?.message?.content || '').slice(0, 500) || null;
  } finally {
    clearTimeout(timeout);
  }
}

async function applyAiSummaries(items, config, disabled) {
  if (disabled || !config.ai.enabled) return items;
  const configured = process.env.DAILY_REPORT_AI_BASE_URL && process.env.DAILY_REPORT_AI_API_KEY && process.env.DAILY_REPORT_AI_MODEL;
  if (!configured) {
    console.warn('[ai] configuration incomplete; keeping feed summaries');
    return items;
  }
  const result = [...items];
  for (let index = 0; index < Math.min(result.length, config.ai.maxItems); index += 1) {
    try {
      const summary = await summarizeWithAi(result[index]);
      if (summary) result[index] = { ...result[index], summary, summaryMethod: 'ai' };
    } catch (error) {
      console.warn(`[ai] item ${index + 1} failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
  }
  return result;
}

function escapeHtml(value) {
  const replacements = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value || '').replace(/[&<>"']/g, (character) => replacements[character]);
}

export function buildHtml(report) {
  const cards = report.items.map((item, index) => `
    <article class="item">
      <span class="rank">${index + 1}</span>
      <div>
        <h2><a href="${escapeHtml(item.url)}" rel="noreferrer">${escapeHtml(item.title)}</a></h2>
        <p>${escapeHtml(item.summary || 'No summary supplied by the feed.')}</p>
        <small>${escapeHtml(item.source)}${item.publishedAt ? ` · ${escapeHtml(item.publishedAt.slice(0, 10))}` : ''}</small>
      </div>
    </article>`).join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(report.title)} · ${escapeHtml(report.date)}</title>
<style>
:root{color-scheme:light;--ink:#172033;--muted:#667085;--line:#e4e7ec;--accent:#2563eb}*{box-sizing:border-box}
body{margin:0;background:#f7f8fb;color:var(--ink);font:16px/1.6 system-ui,-apple-system,sans-serif}.page{max-width:900px;margin:auto;padding:48px 24px}
header{margin-bottom:28px}h1{font-size:34px;line-height:1.2;margin:0 0 8px}header p,small{color:var(--muted)}
.item{display:grid;grid-template-columns:36px 1fr;gap:12px;background:white;border:1px solid var(--line);border-radius:14px;padding:20px;margin:12px 0}
.rank{display:grid;place-items:center;width:30px;height:30px;border-radius:50%;background:#eff6ff;color:var(--accent);font-weight:700}
h2{font-size:19px;line-height:1.4;margin:0 0 8px}a{color:inherit;text-decoration:none}a:hover{color:var(--accent)}p{margin:0 0 9px}
footer{margin-top:28px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:13px}
</style></head><body><main class="page"><header><h1>${escapeHtml(report.title)}</h1><p>${escapeHtml(report.date)} · ${report.items.length} selected public stories</p></header>${cards}<footer>Generated from public feeds. Verify important facts against the linked original sources before use.</footer></main></body></html>`;
}

function webhookText(report) {
  const lines = report.items.map((item, index) => `${index + 1}. ${item.title}\n${item.url}`);
  return `${report.title} · ${report.date}\n\n${lines.join('\n\n')}`.slice(0, 18_000);
}

async function publish(report, webhookType) {
  const rawUrl = process.env.DAILY_REPORT_WEBHOOK_URL || '';
  if (!rawUrl) throw new Error('DAILY_REPORT_WEBHOOK_URL is required with --push');
  const url = validatePublicUrl(rawUrl, 'Webhook URL');
  await ensurePublicResolution(url, 'Webhook URL');
  const text = webhookText(report);
  const body = webhookType === 'feishu'
    ? { msg_type: 'text', content: { text } }
    : { title: report.title, date: report.date, text, items: report.items.map(({ title, url: itemUrl, source, publishedAt }) => ({ title, url: itemUrl, source, publishedAt })) };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const response = await fetch(url, { method: 'POST', redirect: 'error', signal: controller.signal, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error(`Webhook HTTP ${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

async function readHistory(stateDir) {
  try {
    const data = JSON.parse(await fs.readFile(path.join(stateDir, 'published-hashes.json'), 'utf8'));
    return Array.isArray(data.entries) ? data.entries : [];
  } catch { return []; }
}

async function writeHistory(stateDir, date, items, existing) {
  const cutoff = new Date(`${date}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 30);
  const entries = existing.filter((entry) => typeof entry.date === 'string' && entry.date >= cutoff.toISOString().slice(0, 10));
  for (const item of items) if (!entries.some((entry) => entry.hash === item.hash)) entries.push({ date, hash: item.hash });
  await fs.mkdir(stateDir, { recursive: true, mode: 0o700 });
  await writeAtomic(path.join(stateDir, 'published-hashes.json'), `${JSON.stringify({ entries }, null, 2)}\n`);
}

async function writeAtomic(target, content) {
  const temporary = `${target}.${process.pid}.tmp`;
  await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600 });
  await fs.rename(temporary, target);
}

function reportDate(timeZone, override) {
  if (override) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(override)) throw new Error('--date must use YYYY-MM-DD');
    return override;
  }
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
  catch { throw new Error(`Invalid timeZone: ${timeZone}`); }
}

export async function run(options) {
  const rawConfig = JSON.parse(await fs.readFile(options.config, 'utf8'));
  const config = normalizeConfig(rawConfig);
  if (options.maxItems !== null) config.maxItems = clamp(options.maxItems, 1, 50, config.maxItems);
  const date = reportDate(config.timeZone, options.date);
  const existingHistory = await readHistory(options.stateDir);
  let rawItems = [];
  if (options.fixture) {
    const xml = await fs.readFile(options.fixture, 'utf8');
    rawItems = parseFeed(xml, { name: 'Local fixture', weight: 1 });
  } else {
    const batches = await Promise.all(config.sources.map(async (source) => {
      try {
        const xml = await fetchText(source.url);
        const items = parseFeed(xml, source);
        console.log(`[source] ${source.name}: ${items.length}`);
        return items;
      } catch (error) {
        console.warn(`[source] ${source.name} failed: ${error instanceof Error ? error.message : 'unknown error'}`);
        return [];
      }
    }));
    rawItems = batches.flat();
  }
  const selected = filterAndRank(rawItems, config, {
    history: existingHistory.map((entry) => entry.hash),
    now: referenceTime(options.date),
    maxItems: config.maxItems,
    ignoreAge: options.ignoreAge,
  });
  if (!selected.length) throw new Error('No items matched the configured filters');
  const items = await applyAiSummaries(selected, config, options.noAi);
  const report = { title: config.title, date, generatedAt: new Date().toISOString(), items };
  await fs.mkdir(options.outputDir, { recursive: true });
  const base = path.join(options.outputDir, `daily-report_${date}`);
  await writeAtomic(`${base}.html`, buildHtml(report));
  await writeAtomic(`${base}.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[output] ${base}.html`);
  console.log(`[output] ${base}.json`);
  if (options.push) {
    await publish(report, config.webhookType);
    console.log('[push] completed');
  }
  if (options.push || options.commitHistory) await writeHistory(options.stateDir, date, items, existingHistory);
  return report;
}

async function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) { process.stdout.write(usage()); return; }
    await run(options);
  } catch (error) {
    console.error(`[error] ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
