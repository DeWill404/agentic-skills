---
name: recording-web-walkthroughs
description: Use when asked to produce a video, screen recording, demo, walkthrough, product tour, onboarding clip, release-note demo, or narrated reproduction of a web application flow — including when the result must have a voiceover, must show a visible cursor, or must be produced entirely on-device without cloud services.
---

# Recording Web Walkthroughs

## Overview

Turns a scripted browser session into a narrated MP4 with a visible cursor, smooth scrolling and captions. Everything runs locally: Playwright records, the OS text-to-speech narrates, ffmpeg composes.

**Core principle:** each step is a **chunk** owning one narration clip and one video segment. Both are built to the same duration and concatenated in order, so sync holds *by construction* — there are no global offsets to drift and no lead-in to measure.

**Never retime audio.** Speeding speech up chipmunks it. Only the picture is stretched or compressed to meet the voice.

## When to Use

- "Make a video/demo of this flow", "record a walkthrough", "show me this working"
- Release notes, onboarding guides, bug reproductions, QA evidence
- Any recording that must stay on-device (no cloud TTS, no SaaS screen recorder)

**Not for:** capturing a human's live desktop (use a screen recorder), native/desktop apps (this drives a browser), or editing existing footage.

## Quick Reference

**Run from the skill directory** — `node_modules` lives here. The storyboard and output may live anywhere; pass absolute paths.

```bash
cd /path/to/recording-web-walkthroughs
npm install                                    # playwright
npx playwright install chromium                # one-time, ~100MB
node run.mjs /abs/my.storyboard.mjs --out /abs/demo.mp4
node run.mjs /abs/my.storyboard.mjs --keep --headed  # watch it, keep intermediates
```

Targets can be `http(s)://` or a local `file://` URL (use `pathToFileURL`). Output is viewport-sized H.264 + AAC, `yuv420p`.

A storyboard is a list of steps. Copy `example/demo.storyboard.mjs` and change the URL, selectors and narration.

```js
export default {
  config: { viewport: { width: 1280, height: 800 }, voice: 'Samantha', rate: 190 },
  setup: async ({ ui }) => { /* log in once, seed data */ },
  steps: [
    {
      id: 'filter',                       // unique; names the chunk
      badge: '2 / 5',                     // small caption chip
      caption: 'Filter by title',         // on-screen text
      say: 'Typing in the filter narrows the list as you go.',  // narration
      run: async ({ ui, page }) => {
        await ui.type('#q', 'invoice', 60);
      },
    },
  ],
  teardown: async ({ page }) => { /* delete anything the run created */ },
};
```

`ui` helpers — all move the cursor visibly and scroll the target into view first:

| Helper | Purpose |
|---|---|
| `ui.click(sel)` | Glide to element, ripple, click |
| `ui.type(sel, text, delay)` | Click field, type character by character |
| `ui.choose(sel, value)` | Native `<select>` (see limits) |
| `ui.goto(url, waitSel)` | Navigate, settle on a selector |
| `ui.scrollBy(dy)` / `ui.reveal(loc)` | Smooth scroll |
| `ui.caption(text, badge)` | Change the caption mid-step |
| `ui.at(seconds)` | Hold until N seconds **into this step** — see Timing Within a Step |
| `ui.liftAboveCaption(sel)` | Push fixed bottom-anchored UI above the caption bar |
| `ui.moveTo(x, y)` / `ui.ripple()` | Park the cursor / flash a click ring manually |
| `ui.wait(ms)` / `ui.page` | Hold / the raw Playwright `Page` for anything unsupported |

`setup` runs **before** the recording clock starts, so logging in and navigating there costs zero video seconds. Put anything the viewer shouldn't watch in `setup`.

`ui.choose` forwards to Playwright's `selectOption`, which matches an option's `value` **attribute** first and falls back to its visible text. `<option>Asia/Kolkata</option>` (no `value`) is matched by text; `ui.choose(sel, '')` selects the empty-value option, which is the usual "reset the filter".

## Timing Within a Step

Every action in `run()` fires at the **top** of the chunk, while the narration plays for the chunk's full length. Anything transient — a toast, a spinner, a flash of highlight — will have vanished before the voice describes it.

```js
{
  say: 'Saving confirms it.',  // keep SHORT — see the lifetime rule below
  run: async ({ ui }) => {
    await ui.at(1.0);          // let the sentence get going
    await ui.click('#save');   // toast appears under the words describing it
  },
}
```

`ui.at()` **pins** its chunk: compose will not retime that segment, so the offset you give holds in the finished video. Unpinned chunks are retimed, which would scale any within-chunk offset by the speed factor.

`at()` gates when the action *begins*. `ui.click` then glides the cursor and flashes the ripple before the click actually lands, so the effect appears roughly **0.6s later** than the number you pass (`moveMs` + ripple). Subtract that when aiming at a specific word.

**The lifetime rule.** A transient element bounds its chunk's narration, and `ui.at()` cannot rescue you from breaking it. If a toast auto-hides after 1.5s and the line runs 4s, no offset works — the voice outlives the element either way. Read the app's actual timeout (`setTimeout(..., 1500)`), then keep that chunk's line shorter than it and move the rest into a following step.

Budget narration at roughly **2.5 words/second** at `rate: 190` — so ~50 words for a 20-second video. Measure your first run and adjust; the printed `narration` column is the truth.

## Pacing

Two stages, so you tune either side without breaking sync:

1. **Recording** holds each step until its narration has finished (coarse).
2. **Composing** retimes each segment so it lasts exactly as long as its clip (fine).

To make the video **shorter**, shorten the narration — the picture follows the voice.

`speedClamp` (default `[0.5, 2.0]`) bounds how far a segment may be retimed. But speed is a *quality* problem long before it is a failure: above roughly **1.25×** the cursor visibly darts, and the run warns about it. Treat any such warning as "this step needs more narration or fewer actions", not as noise. If the clamp does stop the picture reaching the voice, the last frame is held — the narration is never cut off.

## Non-Obvious Failures

Every row below is something that actually broke a real run.

| Symptom | Cause | Fix |
|---|---|---|
| The success toast never appears — the very thing the demo exists to prove | The caption bar occupies the bottom strip, so bottom-anchored toasts, snackbars and sticky action bars sit *inside* its box. It is geometry, not just stacking | `ui.liftAboveCaption('#toast', 112)` in `setup` (repositions it; 96 is the bare minimum, ~112 reads as deliberate), or `captions: false` |
| The payoff gets clipped at the very end | The last segment is bounded by the recording's real length, which can fall slightly short of the logged clock | Put the payoff in its own step and add a short trailing step after it |
| Transient UI gone before the voice mentions it | All actions fire at the top of the chunk; narration runs the chunk's full length | `await ui.at(seconds)` before the action |
| No cursor anywhere in the video | Headless browsers paint no pointer | Inject one (the engine does); animate via CSS transition and step the real mouse alongside so `:hover` fires |
| Overlay injection throws `Cannot read properties of undefined` | Injected with `addInitScript`, which runs before `document` exists | Inject after load, per page (the engine does) |
| Cursor darts between targets | Segment retimed above ~1.25× | Lengthen that step's narration or remove actions |
| Clicks land off-screen, viewer sees nothing | Element below the fold | Check viewport first, then `scrollIntoView({behavior:'smooth'})` and settle |
| `waitForURL('**/x')` times out although the app navigated | SPA `pushState` fires no `load` event | Wait on a selector instead, never a URL |
| `Ref eNN not found` between actions | Element handles die on re-render | Use CSS/text selectors, never cached refs |
| Retime silently does nothing | `-ss`/`-to` after `-i` are output options, applied *after* the filter graph, so they fight `setpts` | Use `trim=start=..:end=..,setpts=...` |
| Narration cut off mid-sentence | Video segment shorter than its clip | Pad video with `tpad=stop_mode=clone`; never trim audio to fit |
| Voice sounds chipmunked | Audio was resampled to fit | Retime video only |
| TTS says "sock two", "eye-so twenty-seven thousand" | Acronyms in narration | Spell phonetically in the text (`S.O.C. two`), not by changing voice |
| Second run fails at login | Login rate limiter tripped by repeated takes | Reset it in `setup` |
| Duplicate records pile up each run | Storyboard creates data | Clean up in `teardown`, or the run is not repeatable |
| `<select>` dropdown never appears | OS-drawn, not in the page | Unavoidable — park the cursor and let the value change read as the action; use a custom dropdown if it must be shown |
| `volumedetect` prints nothing | Needs a higher log level | `ffmpeg -hide_banner ...` and read stderr |
| Playwright errors about a missing executable | Browser not installed for this Playwright version | `npx playwright install chromium` |

## Verify Before Claiming Success

An MP4 that exists is not an MP4 that works. The engine asserts automatically and throws on truncated narration; the numbers it prints are the evidence:

- both streams present, video and audio lengths agree within 0.5s
- `truncated: false` for every chunk
- audio mean volume well above −50 dB (a silent track still muxes fine)

Then **look at it** before handing it over. The run prints a `startsAt` column giving each chunk's offset in the finished file — seek there:

```bash
ffmpeg -ss 12.1 -i demo.mp4 -frames:v 1 frame.png
```

Ask of each frame: **is the thing the narration claims happened actually visible?** Not "does the caption match" — a caption can agree with the narration while the result it describes is hidden behind the caption bar, already faded, or off-screen. Two defects survive a fully passing build:

- a selector that matched the wrong element, so the voice describes one thing while another is shown
- a result that was covered, or expired, before the frame it belongs in

## Swapping the Voice

Default is macOS `say`. Anything better is a CLI away — set `ttsCommand` in config:

```js
ttsCommand: async ({ text, outFile }) => {
  await execFile('piper', ['--model', 'en_US-lessac-medium.onnx', '--output_file', outFile], { input: text });
},
```

Piper and Kokoro both run offline and beat `say`. Reach for them only if the stock voice is genuinely the weak point — phonetic spelling fixes mispronunciation for free.

## Files

- `run.mjs` — CLI (`--keep` leaves intermediates in `.walkthrough/` beside the output)
- `lib/engine.mjs` — the three passes, `ui` helpers, verification
- `example/demo-app.html` + `example/demo.storyboard.mjs` — working example, no network needed

The example is a deliberately easy target: its dialog has no auto-dismiss, so it exercises none of the transient-UI problems above. Copy its structure, not its assumptions.
