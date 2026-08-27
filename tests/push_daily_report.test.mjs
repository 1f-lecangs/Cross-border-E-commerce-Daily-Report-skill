import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { buildHtml, filterAndRank, normalizeConfig, parseFeed, validatePublicUrl } from '../cross-border-e-commerce-daily-report/scripts/push_daily_report.mjs';
import { parseAdapter, supportedAdapters } from '../cross-border-e-commerce-daily-report/scripts/source_adapters.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixturePath = path.join(root, 'tests', 'fixtures', 'sample-feed.xml');
const configPath = path.join(root, 'cross-border-e-commerce-daily-report', 'references', 'sources.example.json');
const fixture = (name) => path.join(root, 'tests', 'fixtures', name);

test('rejects local, private, credential-bearing, and non-http URLs', () => {
  for (const value of ['http://localhost/feed', 'http://127.0.0.1/feed', 'http://10.0.0.8/feed', 'file:///tmp/feed', 'https://user:pass@example.com/feed']) {
    assert.throws(() => validatePublicUrl(value));
  }
  assert.equal(validatePublicUrl('https://example.com/feed').hostname, 'example.com');
});

test('parses, filters, ranks, and removes excluded topics', async () => {
  const xml = await fs.readFile(fixturePath, 'utf8');
  const rawConfig = JSON.parse(await fs.readFile(configPath, 'utf8'));
  const config = normalizeConfig(rawConfig);
  const items = parseFeed(xml, { name: 'Fixture', weight: 2 });
  const selected = filterAndRank(items, config, { ignoreAge: true, now: Date.parse('2026-08-27T00:00:00Z') });
  assert.equal(items.length, 4);
  assert.equal(selected.length, 3);
  assert.ok(selected.every((item) => !item.title.toLowerCase().includes('sports')));
  assert.ok(selected[0].score >= selected.at(-1).score);
});

test('normalizes allowlisted adapters and rejects URL overrides', () => {
  const config = normalizeConfig({
    sources: [{ name: '雨果网', adapter: 'ikjzd-news', weight: 3, maxItems: 8 }],
    maxItemsPerSource: 2,
  });
  assert.equal(config.sources[0].adapter, 'ikjzd-news');
  assert.equal(config.maxItemsPerSource, 2);
  assert.ok(supportedAdapters().includes('cifnews-home'));
  assert.throws(() => normalizeConfig({ sources: [{ name: 'Invalid', adapter: 'unknown' }] }), /Unsupported source adapter/);
  assert.throws(() => normalizeConfig({ sources: [{ name: 'Override', adapter: 'ikjzd-news', url: 'https:\/\/example.com' }] }), /must not override/);
});

test('parses synthetic Chinese source fixtures and rejects off-domain links', async () => {
  const cases = [
    ['cifnews-home', 'cifnews.html', 'CIFNews', 1],
    ['data10100-news', 'data10100.html', '大数跨境', 2],
    ['ikjzd-news', 'ikjzd.html', '雨果网', 2],
  ];
  for (const [adapter, file, name, expected] of cases) {
    const body = await fs.readFile(fixture(file), 'utf8');
    const items = parseAdapter(adapter, body, { name, weight: 3, maxItems: 12 });
    assert.equal(items.length, expected, adapter);
    assert.ok(items.every((item) => item.url.startsWith('https://')));
    assert.ok(items.every((item) => !item.url.includes('evil.example') && !item.url.includes('127.0.0.1')));
  }
});

test('limits final results from any single source', () => {
  const config = normalizeConfig({
    maxItems: 6,
    maxItemsPerSource: 2,
    includeKeywords: ['物流'],
    sources: [{ name: 'Fixture', url: 'https://example.com/feed' }],
  });
  const items = [
    ...Array.from({ length: 5 }, (_, index) => ({ title: `物流资讯甲${index}`, summary: '跨境物流', url: `https://a.example/${index}`, source: '来源甲', sourceWeight: 3, publishedAt: null })),
    ...Array.from({ length: 3 }, (_, index) => ({ title: `物流资讯乙${index}`, summary: '跨境物流', url: `https://b.example/${index}`, source: '来源乙', sourceWeight: 2, publishedAt: null })),
  ];
  const selected = filterAndRank(items, config, { ignoreAge: true });
  assert.equal(selected.length, 4);
  assert.equal(selected.filter((item) => item.source === '来源甲').length, 2);
  assert.equal(selected.filter((item) => item.source === '来源乙').length, 2);
});

test('reserves configured slots for matching adapter sources', () => {
  const config = normalizeConfig({
    maxItems: 4,
    maxItemsPerSource: 4,
    minAdapterItems: 2,
    includeKeywords: ['跨境'],
    sources: [{ name: 'Fixture', url: 'https://example.com/feed' }],
  });
  const items = [
    ...Array.from({ length: 4 }, (_, index) => ({ title: `Cross-border feed ${index}`, summary: '跨境资讯', url: `https://feed.example/${index}`, source: '英文 RSS', sourceWeight: 5, sourceType: 'feed', publishedAt: null })),
    ...Array.from({ length: 2 }, (_, index) => ({ title: `跨境平台中文资讯${index}`, summary: '跨境资讯', url: `https://adapter.example/${index}`, source: '中文页面', sourceWeight: 1, sourceType: 'adapter', publishedAt: null })),
  ];
  const selected = filterAndRank(items, config, { ignoreAge: true });
  assert.equal(selected.length, 4);
  assert.equal(selected.filter((item) => item.sourceType === 'adapter').length, 2);
});

test('escapes feed-controlled content in HTML', () => {
  const html = buildHtml({
    title: '<Unsafe title>',
    date: '2026-08-27',
    items: [{ title: '<img src=x>', url: 'https://example.com/?a=1&b=2', summary: '<script>alert(1)</script>', source: 'Fixture', publishedAt: null }],
  });
  assert.ok(html.includes('&lt;Unsafe title&gt;'));
  assert.ok(html.includes('&lt;img src=x&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
});

test('CLI fixture run generates local HTML and JSON without secrets or network', async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'cross-border-e-commerce-daily-report-'));
  const script = path.join(root, 'cross-border-e-commerce-daily-report', 'scripts', 'push_daily_report.mjs');
  const result = spawnSync(process.execPath, [script, '--config', configPath, '--fixture', fixturePath, '--ignore-age', '--no-ai', '--date', '2026-08-27', '--output-dir', outputDir], {
    encoding: 'utf8',
    env: {},
  });
  assert.equal(result.status, 0, result.stderr);
  const json = JSON.parse(await fs.readFile(path.join(outputDir, 'daily-report_2026-08-27.json'), 'utf8'));
  const html = await fs.readFile(path.join(outputDir, 'daily-report_2026-08-27.html'), 'utf8');
  assert.equal(json.items.length, 3);
  assert.ok(html.includes('跨境电商卖家每日资讯'));
  assert.ok(!html.includes('DAILY_REPORT_AI_API_KEY'));
  assert.ok(!html.includes('DAILY_REPORT_WEBHOOK_URL'));
});
