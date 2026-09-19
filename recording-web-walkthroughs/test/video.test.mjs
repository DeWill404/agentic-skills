import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeWalkthrough } from '../lib/engine.mjs';

const exec = promisify(execFile);
export const APP = pathToFileURL(
  path.join(import.meta.dirname, 'fixtures', 'red-app.html')).href;

/**
 * Average luma of one frame, optionally of one cropped region.
 * This is how a test sees a picture: every region of the fixture sits far
 * enough apart in luma that a threshold says which one is on screen.
 */
export async function luma(file, t, crop) {
  const vf = [crop, 'signalstats', 'metadata=print:key=lavfi.signalstats.YAVG']
    .filter(Boolean).join(',');
  const { stderr } = await exec('ffmpeg',
    ['-v', 'info', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', vf, '-f', 'null', '-'],
    { maxBuffer: 64 << 20 });
  const m = stderr.match(/YAVG=([\d.]+)/);
  if (!m) throw new Error(`no YAVG for ${file} at ${t}s`);
  return parseFloat(m[1]);
}

export function workspace() {
  const dir = mkdtempSync(path.join(tmpdir(), 'wt-'));
  return { dir, out: path.join(dir, 'out.mp4'), opts: { workDir: path.join(dir, '.w') } };
}

test('setup time does not shift the finished video', async () => {
  const { dir, out, opts } = workspace();
  try {
    await makeWalkthrough({
      config: { viewport: { width: 320, height: 200 }, captions: false },
      // 3s of recorded footage that the viewer must never see.
      setup: async ({ ui, page }) => {
        await page.waitForTimeout(3000);
        await ui.goto(APP, '#panel');
      },
      steps: [
        { id: 'one', say: 'The panel is already on screen.', run: async ({ ui }) => ui.wait(200) },
        { id: 'two', say: 'And it stays there.', run: async ({ ui }) => ui.wait(200) },
      ],
    }, { out, ...opts });

    // The pre-navigation page is near white (about 235). The app is red with a
    // white panel and a green footer, which averages well under 150.
    assert.ok(await luma(out, 0.2) < 150, 'first frame is the blank pre-setup page');
    assert.ok(await luma(out, 1.5) < 150, 'a later frame is the blank pre-setup page');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the caption strip sits below the picture, never over it', async () => {
  const { dir, out, opts } = workspace();
  try {
    const res = await makeWalkthrough({
      config: { viewport: { width: 320, height: 200 } },
      setup: async ({ ui }) => { await ui.goto(APP, '#panel'); },
      steps: [
        { id: 'one', badge: '1 / 1', caption: 'a caption long enough to wrap onto a second line',
          say: 'The footer stays visible.', run: async ({ ui }) => ui.wait(200) },
      ],
    }, { out, ...opts });

    assert.equal(res.verify.width, 320);
    assert.equal(res.verify.height, 272, 'frame should grow by captionHeight');
    // The app keeps all 200 of its rows: the green footer occupies the bottom
    // 40 of them and must still be green, not covered by a caption bar.
    assert.ok(await luma(out, 0.6, 'crop=320:30:0:165') > 120, 'the footer was covered');
    // The strip below the picture is the dark caption bar.
    assert.ok(await luma(out, 0.6, 'crop=320:72:0:200') < 60, 'no caption strip below the picture');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the video opens on the title card', async () => {
  const { dir, out, opts } = workspace();
  try {
    const res = await makeWalkthrough({
      title: 'Red panel',
      subtitle: 'a one step tour',
      config: { viewport: { width: 320, height: 200 } },
      setup: async ({ ui }) => { await ui.goto(APP, '#panel'); },
      steps: [
        { id: 'one', caption: 'the panel', say: 'Here is the panel.',
          run: async ({ ui }) => ui.wait(200) },
      ],
    }, { out, ...opts });

    assert.equal(res.report[0].id, 'title');
    assert.equal(res.report[0].startsAt, 0);
    assert.ok(Math.abs(res.report[0].final - 2.5) < 0.2, `card ran ${res.report[0].final}s`);
    // The card is near black. The app that follows is not.
    assert.ok(await luma(out, 0.3) < 40, 'the video does not open on the title card');
    assert.ok(await luma(out, res.report[1].startsAt + 0.3) > 40, 'the app never arrives');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('highlight darkens the page but not the target', async () => {
  const { dir, out, opts } = workspace();
  try {
    const res = await makeWalkthrough({
      config: { viewport: { width: 320, height: 200 } },
      setup: async ({ ui }) => { await ui.goto(APP, '#panel'); },
      steps: [
        { id: 'plain', caption: 'no highlight', say: 'This is the whole page.',
          run: async ({ ui }) => ui.wait(200) },
        { id: 'lit', caption: 'highlighted', say: 'Now only the panel matters here.',
          run: async ({ ui }) => { await ui.highlight('#panel'); } },
      ],
    }, { out, ...opts });

    const at = (id) => res.report.find((r) => r.id === id).startsAt;
    // Both crops must stay clear of the highlight box itself, which rings the
    // panel with 8px of padding: inside the ring nothing is dimmed, which is
    // the point of it.
    const away = 'crop=60:40:250:100'; // red body, clear of the panel and footer
    const inside = 'crop=80:40:50:50'; // inside the white panel

    const plainAway = await luma(out, at('plain') + 0.3, away);
    const litAway = await luma(out, at('lit') + 1.0, away);
    assert.ok(litAway < plainAway - 15,
      `the rest of the page was not dimmed (${plainAway} -> ${litAway})`);

    const litInside = await luma(out, at('lit') + 1.0, inside);
    assert.ok(litInside > 200, `the target was dimmed too (${litInside})`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
