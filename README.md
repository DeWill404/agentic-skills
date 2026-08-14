# agent-skills

A collection of agent skills — self-contained capability packages that Claude Code, Cursor, and
other skill-aware agents load on demand.

Each top-level directory is one skill. A skill is a `SKILL.md` describing when and how to use it,
plus whatever code, examples, and dependencies it needs to actually do the work.

## Layout

```
agent-skills/
└── recording-web-walkthroughs/   # narrated MP4 walkthroughs of web apps
    ├── SKILL.md                  # frontmatter (name, description) + the instructions
    ├── run.mjs                   # CLI entry point
    ├── lib/engine.mjs            # narrate → record → compose
    ├── example/                  # runnable example, no network needed
    └── package.json              # dependencies scoped to this skill
```

`SKILL.md` frontmatter is the contract with the agent: `name` must match the directory, and
`description` is what the agent matches a user request against, so it lists the trigger phrasings
explicitly rather than summarising.

Dependencies are per-skill, never hoisted to the root. Each skill installs and runs from its own
directory so it can be copied out on its own and still work.

## Skills

### `recording-web-walkthroughs`

Turns a scripted browser session into a narrated MP4 with a visible cursor, smooth scrolling, and
captions. Playwright records, the OS text-to-speech narrates, ffmpeg composes — entirely on-device,
no cloud services.

The design centres on one idea: each step is a **chunk** owning one narration clip and one video
segment, both built to the same duration. Sync holds by construction, with no global offsets to
drift. Audio is never retimed — only the picture stretches to meet the voice.

```bash
cd recording-web-walkthroughs
npm install
npx playwright install chromium          # one-time, ~100MB

node run.mjs example/demo.storyboard.mjs --out example/demo.mp4
node run.mjs /abs/my.storyboard.mjs --keep --headed   # watch it, keep intermediates
```

See [`recording-web-walkthroughs/SKILL.md`](recording-web-walkthroughs/SKILL.md) for the storyboard
format, the `ui` helpers, within-step timing, and a table of non-obvious failures.

**Requirements and constraints**

- **macOS by default.** Narration uses the built-in `say` command. Other platforms need a
  `ttsCommand` in the storyboard config (Piper and Kokoro both run offline).
- **`ffmpeg` and `ffprobe` on `PATH`**, used for every compose and verification step.
- **Node 20.11+** for ESM and `import.meta.dirname`; developed against Node 22.
- **Run from the skill directory** — `node_modules` lives there. Storyboards and outputs may live
  anywhere, passed as absolute paths.
- **Browser flows only.** It drives Chromium, so it cannot capture a native app or a human's live
  desktop, and it cannot edit existing footage.
- Native `<select>` dropdowns are drawn by the OS, outside the page, so they never appear in the
  recording.

## Adding a skill

1. Create a directory named after the skill, in kebab-case.
2. Write `SKILL.md` with `name` and `description` frontmatter. Spell out the situations that should
   trigger it — that description is the only thing the agent sees before deciding to load the skill.
3. Keep dependencies, examples, and generated media inside the directory, and add a `.gitignore`
   for anything regenerable (`node_modules/`, rendered video, intermediates).
4. Document the failures you actually hit while building it. The value of a skill is mostly in the
   non-obvious things that broke.

## Using these skills

Copy or symlink a skill directory into an agent's skills path, for example:

```bash
ln -s "$PWD/recording-web-walkthroughs" ~/.claude/skills/recording-web-walkthroughs
ln -s "$PWD/recording-web-walkthroughs" ~/.cursor/skills/recording-web-walkthroughs
```

Symlinking keeps the installed copy in step with this repo. Skills that install dependencies need
`npm install` run once inside the real directory, not the link.
