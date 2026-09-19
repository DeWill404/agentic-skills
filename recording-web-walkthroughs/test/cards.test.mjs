import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { captionHtml, titleHtml, buildCards } from '../lib/cards.mjs';
import { DEFAULTS } from '../lib/engine.mjs';

const exec = promisify(execFile);
const cfg = { ...DEFAULTS, viewport: { width: 400, height: 300 } };

const dims = async (file) => (await exec('ffprobe', ['-v', 'error',
  '-show_entries', 'stream=width,height', '-of', 'csv=p=0:s=x', file])).stdout.trim();

test('caption escapes markup and keeps the badge', () => {
  const html = captionHtml({ text: 'a < b & c', badge: '2 / 9', width: 1280, height: 72, cfg });
  assert.match(html, /a &lt; b &amp; c/);
  assert.match(html, /2 \/ 9/);
  assert.doesNotMatch(html, /a < b/);
});

test('caption without a badge renders no chip', () => {
  const html = captionHtml({ text: 'hi', width: 1280, height: 72, cfg });
  assert.doesNotMatch(html, /class="badge"/);
});

test('fonts live in a style block, never in a style attribute', () => {
  // A quoted family name inside style="..." closes the attribute early and the
  // rest of the declaration is dropped, which renders the card in Times.
  for (const html of [
    captionHtml({ text: 'x', width: 10, height: 10, cfg }),
    titleHtml({ title: 'x', width: 10, height: 10, cfg }),
  ]) {
    assert.match(html, /<style>/);
    assert.doesNotMatch(html, /style="[^"]*font/);
  }
});

test('title card carries the title and an optional subtitle', () => {
  const both = titleHtml({ title: 'Studio tour', subtitle: 'nine steps', width: 1280, height: 872, cfg });
  assert.match(both, /Studio tour/);
  assert.match(both, /nine steps/);
  assert.doesNotMatch(titleHtml({ title: 'T', width: 10, height: 10, cfg }), /<p>/);
});

test('buildCards writes PNGs at exactly the configured sizes', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cards-'));
  try {
    const cards = await buildCards(
      { title: 'T', subtitle: 'S' },
      { one: { text: 'hello', badge: '1 / 2' }, two: { text: '', badge: '' } },
      dir, cfg,
    );
    assert.equal(await dims(cards.captions.one), '400x72');
    assert.equal(await dims(cards.title), '400x372');
    assert.equal(cards.captions.two, undefined, 'a step with no text needs no strip');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
