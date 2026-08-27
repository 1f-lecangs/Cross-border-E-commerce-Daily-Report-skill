import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { buildHtml, filterAndRank, normalizeConfig, parseFeed, validatePublicUrl } from '../cross-border-e-commerce-daily-report/scripts/push_daily_report.mjs';

const root = path.resolve(import.meta.dirname, '..');
const fixturePath = path.join(root, 'tests', 'fixtures', 'sample-feed.xml');
const configPath = path.join(root, 'cross-border-e-commerce-daily-report', 'references', 'sources.example.json');

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
  assert.ok(html.includes('Cross-border Commerce Daily Brief'));
  assert.ok(!html.includes('DAILY_REPORT_AI_API_KEY'));
  assert.ok(!html.includes('DAILY_REPORT_WEBHOOK_URL'));
});
