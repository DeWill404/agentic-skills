// Narrated web walkthrough engine.
//
// Three passes. Each step is a CHUNK owning one narration clip and one video
// segment, so the two can be tuned independently and still line up.
//
//   1. speak()   — render one audio clip per step, measure it
//   2. record()  — drive the browser, log each step's segment boundary
//   3. compose() — cut the video at those boundaries, retime each segment to
//                  its clip, then concatenate video and audio in lockstep
//
// Sync is structural, not arithmetic: segment i of the video and segment i of
// the audio are built to the SAME duration, then both concatenated in order.
// There are no global offsets to drift and no lead-in to measure.
//
// Audio is never retimed. Speeding speech up chipmunks it, so only the picture
// is stretched or compressed to meet the voice.

import { chromium, firefox, webkit } from 'playwright';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdirSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const exec = promisify(execFile);
const sh = async (bin, args) => (await exec(bin, args, { maxBuffer: 64 << 20 })).stdout;

export const DEFAULTS = {
  viewport: { width: 1280, height: 800 },
  browser: 'chromium',
  headless: true,
  fps: 25,
  crf: 23,
  moveMs: 400,        // cursor glide, mirrored by the CSS transition
  scrollMs: 550,      // smooth-scroll settle
  tailMs: 250,        // breath after each narration line
  minSegment: 1.2,    // s — floor so silent steps still read
  speedClamp: [0.5, 2.0], // retime limits; outside this we pad instead
  voice: 'Samantha',  // macOS `say`
  rate: 190,          // words per minute
  cursor: true,
  captions: true,
  captionHeight: 72,      // px of letterbox added below the picture for captions
  captionBg: '#111418',
  captionFg: '#ffffff',
  titleBg: '#0b0d10',
  accent: '#e5484d',      // badge chip, click ripple, highlight ring
  titleMs: 2500,          // how long the title card is held
  // Playwright's screencast starts with the page, and starts this long after
  // newPage() resolves. Measured over three runs on macOS/chromium: 0.103,
  // 0.125 and 0.136s, with no drift across 12s. It is a property of the
  // screencast, not a constant of nature, so tune it if your first frames
  // land late or early.
  videoLeadIn: 0.12,
  keepIntermediates: false,
};

/* ------------------------------------------------------------------ utils */

export async function probeDuration(file) {
  const out = await sh('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=nw=1:nk=1', file,
  ]);
  const d = parseFloat(out.trim());
  if (!Number.isFinite(d)) throw new Error(`could not probe duration: ${file}`);
  return d;
}

const clamp = (v, [lo, hi]) => Math.min(hi, Math.max(lo, v));

/* ------------------------------------------------------- pass 1: narration */

/**
 * Render one audio clip per narrating step and measure it.
 *
 * ttsCommand lets you swap in Piper/Kokoro/any CLI. It receives
 * ({ text, outFile, cfg }) and must write a real audio file to outFile.
 */
export async function speak(steps, dir, cfg) {
  mkdirSync(dir, { recursive: true });
  const clips = {};
  for (const step of steps) {
    if (!step.say) continue;
    const out = path.join(dir, `${step.id}.m4a`);
    if (cfg.ttsCommand) {
      await cfg.ttsCommand({ text: step.say, outFile: out, cfg });
    } else {
      const aiff = path.join(dir, `${step.id}.aiff`);
      await sh('say', ['-v', cfg.voice, '-r', String(cfg.rate), '-o', aiff, step.say]);
      await sh('ffmpeg', ['-y', '-loglevel', 'error', '-i', aiff,
        '-ar', '44100', '-ac', '2', out]);
      rmSync(aiff, { force: true });
    }
    clips[step.id] = { file: out, duration: await probeDuration(out) };
  }
  return clips;
}

/* -------------------------------------------------- browser-side overlay */

// Injected into the page. Headless browsers paint no pointer, so we draw one.
// The CSS transition does the tweening — we only ever set a destination.
function overlayScript({ x, y, moveMs, cursor, captions }) {
  if (captions && !document.getElementById('__wt_cap')) {
    const cap = document.createElement('div');
    cap.id = '__wt_cap';
    cap.style.cssText = [
      'position:fixed', 'left:0', 'right:0', 'bottom:0', 'z-index:2147483646',
      'background:#111', 'color:#fff', 'padding:10px 18px',
      'font:500 15px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif',
      'display:flex', 'gap:12px', 'align-items:center',
      'pointer-events:none', 'letter-spacing:.2px',
    ].join(';');
    document.body.appendChild(cap);
  }
  if (cursor && !document.getElementById('__wt_cur')) {
    const cur = document.createElement('div');
    cur.id = '__wt_cur';
    cur.style.cssText = [
      'position:fixed', 'z-index:2147483647', 'pointer-events:none',
      'width:24px', 'height:24px', 'margin:-2px 0 0 -2px',
      `left:${x}px`, `top:${y}px`,
      `transition:left ${moveMs}ms cubic-bezier(.4,0,.2,1),`
      + `top ${moveMs}ms cubic-bezier(.4,0,.2,1)`,
    ].join(';');
    cur.innerHTML =
      '<svg width="24" height="24" viewBox="0 0 24 24"'
      + ' style="filter:drop-shadow(0 1px 3px rgba(0,0,0,.5))">'
      + '<path d="M5 2l0 17 4.2-4.2 2.6 6.1 3.3-1.4-2.6-6.1 5.9 0z"'
      + ' fill="#111" stroke="#fff" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    document.body.appendChild(cur);
  }
}

/* ------------------------------------------------- pass 2: drive + record */

/**
 * Run the storyboard against a live browser and record it.
 * Returns { video, segments: [{ id, start, end }] } with times in seconds
 * relative to the start of the video file.
 */
export async function record(storyboard, clips, dir, cfg) {
  mkdirSync(dir, { recursive: true });
  const engineFor = { chromium, firefox, webkit }[cfg.browser];
  if (!engineFor) throw new Error(`unknown browser: ${cfg.browser}`);

  const browser = await engineFor.launch({ headless: cfg.headless });
  const context = await browser.newContext({
    viewport: cfg.viewport,
    recordVideo: { dir, size: cfg.viewport },
    deviceScaleFactor: 1,
    ...(storyboard.contextOptions || {}),
  });
  const page = await context.newPage();
  // Playwright's video starts with the page, not with the first step. Every
  // trim offset in compose() is measured from here. Anchoring it any later,
  // after setup for instance, shifts the whole film earlier by however long
  // setup took: a storyboard whose setup logs in for 4s then produced a video
  // that was the blank pre-navigation page from first frame to last.
  const videoT0 = Date.now();

  let cursor = { x: cfg.viewport.width / 2, y: cfg.viewport.height / 2 };
  const segments = [];
  let stepBegan = 0;
  let currentStep = null;
  const pinned = new Set(); // steps using ui.at() — must not be retimed
  const now = () => Math.max(0, (Date.now() - videoT0) / 1000 - cfg.videoLeadIn);

  const ensureOverlay = () => page.evaluate(overlayScript, {
    x: cursor.x, y: cursor.y, moveMs: cfg.moveMs,
    cursor: cfg.cursor, captions: cfg.captions,
  }).catch(() => {});

  const ui = {
    page,
    wait: (ms) => page.waitForTimeout(ms),

    /**
     * Hold until `seconds` into the current step, then continue.
     *
     * Actions otherwise all fire at the top of the chunk while the narration
     * plays for its full length — so anything transient (a toast, a spinner,
     * a highlight) is long gone by the time the voice describes it. Use this
     * to land the action under the words that describe it:
     *
     *   say: 'Saving shows a confirmation.'   // 3.1s of speech
     *   run: async ({ ui }) => { await ui.at(1.4); await ui.click('#save'); }
     *
     * Calling this PINS the chunk: compose() will not retime it, so the offset
     * you give holds in the finished video. Without the pin, retiming would
     * scale every within-chunk offset by the segment's speed factor and the
     * action would drift out from under its sentence.
     */
    async at(seconds) {
      pinned.add(currentStep);
      const due = stepBegan + seconds * 1000;
      const left = due - Date.now();
      if (left > 0) await page.waitForTimeout(left);
    },

    /** Raise fixed bottom-anchored UI above the caption bar. */
    async liftAboveCaption(selector, px = 96) {
      if (!cfg.captions) return;
      await page.addStyleTag({ content: `${selector}{bottom:${px}px !important}` });
    },

    async caption(text, badge = '') {
      if (!cfg.captions) return;
      await ensureOverlay();
      await page.evaluate(([text, badge]) => {
        const el = document.getElementById('__wt_cap');
        if (!el) return;
        el.innerHTML =
          (badge
            ? `<span style="background:#e5484d;color:#fff;padding:2px 8px;`
              + `font:600 12px ui-monospace,monospace">${badge}</span>`
            : '') + `<span>${text}</span>`;
      }, [text, badge]);
    },

    /** Glide the drawn cursor and the real mouse to a point. */
    async moveTo(x, y) {
      if (!cfg.cursor) { await page.mouse.move(x, y); cursor = { x, y }; return; }
      await ensureOverlay();
      await page.evaluate(([x, y]) => {
        const c = document.getElementById('__wt_cur');
        if (c) { c.style.left = x + 'px'; c.style.top = y + 'px'; }
      }, [x, y]);
      // Step the real mouse along the same path so :hover states fire.
      const from = cursor;
      const STEPS = 6;
      for (let i = 1; i <= STEPS; i++) {
        await page.mouse.move(
          from.x + ((x - from.x) * i) / STEPS,
          from.y + ((y - from.y) * i) / STEPS
        );
        await page.waitForTimeout(cfg.moveMs / STEPS);
      }
      cursor = { x, y };
    },

    async ripple() {
      if (!cfg.cursor) return;
      await page.evaluate(([x, y]) => {
        const r = document.createElement('div');
        r.style.cssText = [
          'position:fixed', 'z-index:2147483645', 'pointer-events:none',
          `left:${x}px`, `top:${y}px`, 'width:14px', 'height:14px',
          'margin:-7px 0 0 -7px', 'border-radius:50%',
          'border:2px solid #e5484d', 'opacity:.9',
          'transition:transform 380ms ease-out,opacity 380ms ease-out',
        ].join(';');
        document.body.appendChild(r);
        requestAnimationFrame(() => {
          r.style.transform = 'scale(3.4)';
          r.style.opacity = '0';
        });
        setTimeout(() => r.remove(), 500);
      }, [cursor.x, cursor.y]);
      await page.waitForTimeout(220);
    },

    /** Smooth-scroll a target into view only if it is not already visible. */
    async reveal(locator) {
      const ok = await locator.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return r.top >= 72 && r.bottom <= window.innerHeight - 96;
      }).catch(() => true);
      if (ok) return;
      await locator.evaluate((el) =>
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      );
      await page.waitForTimeout(cfg.scrollMs);
    },

    /** Move to an element and click it, visibly. */
    async click(selector, opts = {}) {
      const loc = typeof selector === 'string' ? page.locator(selector).first() : selector;
      await loc.waitFor({ state: 'visible' });
      await ui.reveal(loc);
      const box = await loc.boundingBox();
      if (!box) throw new Error(`no bounding box for ${selector}`);
      await ui.moveTo(box.x + box.width / 2, box.y + box.height / 2);
      await ui.ripple();
      await loc.click(opts);
    },

    /** Click a field then type into it character by character. */
    async type(selector, text, delay = 30) {
      const loc = typeof selector === 'string' ? page.locator(selector).first() : selector;
      await loc.waitFor({ state: 'visible' });
      await ui.reveal(loc);
      const box = await loc.boundingBox();
      await ui.moveTo(box.x + box.width / 2, box.y + box.height / 2);
      await ui.ripple();
      await loc.click();
      await loc.fill('');
      await loc.type(text, { delay });
    },

    /**
     * Pick from a native <select>. The OS-drawn dropdown cannot be captured,
     * so the cursor parks on the control and the value change carries it.
     */
    async choose(selector, value) {
      const loc = typeof selector === 'string' ? page.locator(selector).first() : selector;
      await ui.reveal(loc);
      const box = await loc.boundingBox();
      await ui.moveTo(box.x + box.width / 2, box.y + box.height / 2);
      await ui.ripple();
      await loc.selectOption(value);
      await page.waitForTimeout(400);
    },

    async scrollBy(dy) {
      await page.evaluate((dy) => window.scrollBy({ top: dy, behavior: 'smooth' }), dy);
      await page.waitForTimeout(cfg.scrollMs + 200);
    },

    /**
     * Navigate. Use this instead of waitForURL for SPAs: client-side pushState
     * fires no load event, so URL waits time out even though the app moved.
     * Always settle on a selector you expect to see.
     */
    async goto(url, waitForSelector) {
      await page.goto(url);
      if (waitForSelector) await page.waitForSelector(waitForSelector);
      await ensureOverlay();
    },
  };

  if (storyboard.setup) await storyboard.setup({ ui, page, context });

  for (const step of storyboard.steps) {
    const start = now();
    currentStep = step.id;
    await ui.caption(step.caption ?? '', step.badge ?? '');
    stepBegan = Date.now();

    await step.run?.({ ui, page, context });

    // Coarse pacing: hold the step until its line has finished speaking.
    // compose() then trims the residual mismatch exactly.
    const target = (clips[step.id]?.duration ?? 0) * 1000 + cfg.tailMs;
    const spent = Date.now() - stepBegan;
    if (spent < target) await page.waitForTimeout(target - spent);

    segments.push({ id: step.id, start, end: now(), pinned: pinned.has(step.id) });
  }

  if (storyboard.teardown) await storyboard.teardown({ ui, page, context });

  await context.close();
  await browser.close();

  const file = readdirSync(dir).find((f) => f.endsWith('.webm'));
  if (!file) throw new Error('playwright produced no video — did the context close?');
  return { video: path.join(dir, file), segments };
}

/* ------------------------------------------------------- pass 3: compose */

/**
 * Cut the recording at the logged boundaries, retime each segment so it lasts
 * exactly as long as its narration, then concatenate video and audio in step.
 *
 * Because segment i of both tracks is built to the same length, sync holds by
 * construction — no offsets, no drift, no lead-in correction.
 */
export async function compose({ video, segments }, clips, dir, cfg, outFile) {
  mkdirSync(dir, { recursive: true });
  const total = await probeDuration(video);
  const report = [];

  const vList = [];
  const aList = [];
  let cursorT = 0; // running start offset in the finished file

  for (const [i, seg] of segments.entries()) {
    const clip = clips[seg.id];
    const rawEnd = i === segments.length - 1 ? Math.min(seg.end, total) : seg.end;
    const rawDur = Math.max(0.05, rawEnd - seg.start);
    const want = Math.max(
      (clip?.duration ?? 0) + cfg.tailMs / 1000,
      cfg.minSegment
    );

    // factor > 1 speeds the picture up, < 1 slows it down. Chunks that used
    // ui.at() are pinned at 1.0 so their within-chunk offsets survive intact.
    const ideal = rawDur / want;
    const factor = seg.pinned ? 1 : clamp(ideal, cfg.speedClamp);
    const retimed = rawDur / factor;

    // Never let the picture end before the voice: if the clamp stopped us
    // short, hold the final frame rather than cutting the narration off.
    const speech = clip?.duration ?? 0;
    const segTarget = Math.max(retimed, speech);
    const padDur = segTarget - retimed;

    // trim+setpts, not -ss/-to: as output options those are applied after the
    // filter graph, so they silently fight setpts and the retime is dropped.
    const chain = [
      `trim=start=${seg.start.toFixed(3)}:end=${rawEnd.toFixed(3)}`,
      `setpts=(PTS-STARTPTS)/${factor.toFixed(6)}`,
      ...(padDur > 0.01
        ? [`tpad=stop_mode=clone:stop_duration=${padDur.toFixed(3)}`]
        : []),
      `scale=${cfg.viewport.width}:${cfg.viewport.height}:flags=lanczos`,
      'format=yuv420p',
    ].join(',');

    const vSeg = path.join(dir, `v${String(i).padStart(3, '0')}.mp4`);
    await sh('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-i', video,
      '-vf', chain,
      '-an', '-r', String(cfg.fps),
      '-c:v', 'libx264', '-preset', 'medium', '-crf', String(cfg.crf),
      vSeg,
    ]);
    const vActual = await probeDuration(vSeg);

    // Build the matching audio segment at exactly the video segment's length:
    // the clip, then silence for the remainder (or silence throughout).
    const aSeg = path.join(dir, `a${String(i).padStart(3, '0')}.m4a`);
    if (clip) {
      await sh('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-i', clip.file,
        '-af', 'apad', '-t', vActual.toFixed(3),
        '-ar', '44100', '-ac', '2', '-c:a', 'aac', '-b:a', '128k',
        aSeg,
      ]);
    } else {
      await sh('ffmpeg', [
        '-y', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
        '-t', vActual.toFixed(3), '-c:a', 'aac', '-b:a', '128k',
        aSeg,
      ]);
    }

    vList.push(vSeg);
    aList.push(aSeg);
    report.push({
      id: seg.id,
      // Where this chunk starts in the finished file — seek here to check it.
      startsAt: +cursorT.toFixed(2),
      narration: +speech.toFixed(2),
      rawVideo: +rawDur.toFixed(2),
      speed: +factor.toFixed(3),
      pinned: !!seg.pinned,
      final: +vActual.toFixed(2),
      // Would the voice have been cut off? Must always be false.
      truncated: vActual + 0.05 < speech,
      clamped: !seg.pinned && Math.abs(ideal - factor) > 1e-6,
    });
    cursorT += vActual;
  }

  const concat = async (files, out) => {
    const list = path.join(dir, `${path.basename(out)}.txt`);
    writeFileSync(list, files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n'));
    await sh('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0',
      '-i', list, '-c', 'copy', out]);
  };

  const vAll = path.join(dir, 'video.mp4');
  const aAll = path.join(dir, 'audio.m4a');
  await concat(vList, vAll);
  await concat(aList, aAll);

  await sh('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-i', vAll, '-i', aAll,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
    '-movflags', '+faststart',
    outFile,
  ]);

  return { report, outFile };
}

/* ----------------------------------------------------------- verification */

/** Prove the artefact is real: streams present, lengths agree, audio audible. */
export async function verify(outFile) {
  const streams = await sh('ffprobe', [
    '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,duration',
    '-of', 'json', outFile,
  ]);
  const { streams: s } = JSON.parse(streams);
  const v = s.find((x) => x.codec_type === 'video');
  const a = s.find((x) => x.codec_type === 'audio');

  let mean = null, peak = null;
  try {
    const { stderr } = await exec('ffmpeg',
      ['-hide_banner', '-i', outFile, '-af', 'volumedetect', '-f', 'null', '-'],
      { maxBuffer: 64 << 20 });
    mean = (stderr.match(/mean_volume:\s*(-?[\d.]+)/) || [])[1] ?? null;
    peak = (stderr.match(/max_volume:\s*(-?[\d.]+)/) || [])[1] ?? null;
  } catch { /* volumedetect is advisory */ }

  const problems = [];
  if (!v) problems.push('no video stream');
  if (!a) problems.push('no audio stream');
  if (v && a) {
    const drift = Math.abs(parseFloat(v.duration) - parseFloat(a.duration));
    if (drift > 0.5) problems.push(`video/audio length differ by ${drift.toFixed(2)}s`);
  }
  if (mean !== null && parseFloat(mean) < -50) problems.push(`audio near silent (${mean} dB)`);

  return {
    duration: v ? +parseFloat(v.duration).toFixed(2) : null,
    video: v?.codec_name, audio: a?.codec_name,
    meanVolume: mean, peakVolume: peak, problems,
  };
}

/* -------------------------------------------------------------- top level */

export async function makeWalkthrough(storyboard, options = {}) {
  const cfg = { ...DEFAULTS, ...storyboard.config, ...options };
  const work = options.workDir || path.join(process.cwd(), '.walkthrough');
  const out = options.out || path.join(process.cwd(), 'walkthrough.mp4');

  rmSync(work, { recursive: true, force: true });
  mkdirSync(work, { recursive: true });

  const clips = await speak(storyboard.steps, path.join(work, 'audio'), cfg);
  const spoken = Object.values(clips).reduce((n, c) => n + c.duration, 0);
  console.log(`narration: ${Object.keys(clips).length} lines, ${spoken.toFixed(1)}s`);

  const rec = await record(storyboard, clips, path.join(work, 'raw'), cfg);
  console.log(`recorded: ${(await probeDuration(rec.video)).toFixed(1)}s, ${rec.segments.length} segments`);

  const { report } = await compose(rec, clips, path.join(work, 'seg'), cfg, out);
  const clamped = report.filter((r) => r.clamped);
  const cut = report.filter((r) => r.truncated);
  console.table(report);
  if (cut.length) {
    throw new Error(
      `narration would be cut off in: ${cut.map((r) => r.id).join(', ')}. `
      + `This is a bug in the retime guard — do not ship this file.`
    );
  }
  if (clamped.length) {
    console.warn(
      `${clamped.length} segment(s) hit the speed clamp — the picture could not be `
      + `stretched far enough to meet the voice. Shorten those narration lines or `
      + `add actions to the step.`
    );
  }
  // Visible long before the clamp: past ~1.25x the cursor visibly darts.
  const rushed = report.filter((r) => !r.clamped && r.speed > 1.25);
  if (rushed.length) {
    console.warn(
      `fast playback in: ${rushed.map((r) => `${r.id} (${r.speed}x)`).join(', ')}. `
      + `Above ~1.25x the cursor darts. Lengthen the narration or trim the actions.`
    );
  }

  const v = await verify(out);
  console.log(v.problems.length ? `PROBLEMS: ${v.problems.join('; ')}` : 'verified: streams present, lengths agree, audio audible');
  console.log(`TOTAL ${v.duration}s  ${out}  ${v.video}/${v.audio}  mean ${v.meanVolume} dB`);

  if (!cfg.keepIntermediates) rmSync(work, { recursive: true, force: true });
  return { out, report, verify: v };
}
