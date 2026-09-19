// Text that reaches the finished video is rendered by the browser, not by
// ffmpeg. The usual ffmpeg build carries no libfreetype and therefore has no
// drawtext filter at all. Rendering in the Chromium this skill already drives
// also buys line wrapping, clamping, the badge chip and real font stacks for
// nothing, none of which drawtext would have given us.
import { chromium, firefox, webkit } from 'playwright';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const SANS = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';

const esc = (s) => String(s ?? '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

// Every rule goes in a <style> block. A quoted family name inside a
// style="..." attribute closes the attribute and the rest of the declaration
// is dropped, which is how the first attempt at this rendered in Times.
const doc = (css, body) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{box-sizing:border-box}html,body{margin:0;padding:0}
${css}</style></head><body>${body}</body></html>`;

export function captionHtml({ text = '', badge = '', width, height, cfg }) {
  return doc(`
body{width:${width}px;height:${height}px;background:${cfg.captionBg};color:${cfg.captionFg};
  display:flex;align-items:center;gap:14px;padding:0 28px;
  font:500 20px/1.35 ${SANS};letter-spacing:.2px}
.badge{flex:0 0 auto;background:${cfg.accent};color:#fff;border-radius:4px;
  padding:3px 9px;font:600 14px ${MONO}}
.text{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}`,
    (badge ? `<span class="badge">${esc(badge)}</span>` : '')
    + `<span class="text">${esc(text)}</span>`);
}

export function titleHtml({ title, subtitle = '', width, height, cfg }) {
  return doc(`
body{width:${width}px;height:${height}px;background:${cfg.titleBg};color:${cfg.captionFg};
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:20px;
  text-align:center;padding:0 12%;font-family:${SANS}}
.rule{width:56px;height:4px;border-radius:2px;background:${cfg.accent}}
h1{margin:0;font:600 54px/1.15 ${SANS};letter-spacing:-.5px}
p{margin:0;font:400 24px/1.4 ${SANS};color:#9aa4b2}`,
    `<div class="rule"></div><h1>${esc(title)}</h1>`
    + (subtitle ? `<p>${esc(subtitle)}</p>` : ''));
}

/** Screenshot each job to its file. One browser for the lot. */
export async function renderCards(jobs, cfg) {
  if (!jobs.length) return;
  const engineFor = { chromium, firefox, webkit }[cfg.browser];
  if (!engineFor) throw new Error(`unknown browser: ${cfg.browser}`);
  const browser = await engineFor.launch({ headless: true });
  try {
    for (const job of jobs) {
      const ctx = await browser.newContext({
        viewport: { width: job.width, height: job.height },
        deviceScaleFactor: 1,
      });
      const page = await ctx.newPage();
      await page.setContent(job.html, { waitUntil: 'load' });
      await page.screenshot({ path: job.file });
      await ctx.close();
    }
  } finally {
    await browser.close();
  }
}

/**
 * Render the title card and one caption strip per captioned step.
 * `captions` is { [stepId]: { text, badge } } as collected during recording,
 * and the returned `captions` maps the same ids to PNG paths.
 */
export async function buildCards(storyboard, captions, dir, cfg) {
  mkdirSync(dir, { recursive: true });
  const width = cfg.viewport.width;
  const frameH = cfg.viewport.height + (cfg.captions ? cfg.captionHeight : 0);
  const jobs = [];
  const out = { title: null, captions: {} };

  if (storyboard.title) {
    out.title = path.join(dir, 'title.png');
    jobs.push({
      file: out.title, width, height: frameH,
      html: titleHtml({
        title: storyboard.title, subtitle: storyboard.subtitle,
        width, height: frameH, cfg,
      }),
    });
  }

  if (cfg.captions) {
    for (const [id, cap] of Object.entries(captions)) {
      if (!cap.text && !cap.badge) continue; // the bare bar is the same pixels
      const file = path.join(dir, `cap-${id}.png`);
      out.captions[id] = file;
      jobs.push({
        file, width, height: cfg.captionHeight,
        html: captionHtml({ ...cap, width, height: cfg.captionHeight, cfg }),
      });
    }
  }

  await renderCards(jobs, cfg);
  return out;
}
