#!/usr/bin/env node
// CLI: node run.mjs <storyboard.mjs> [--out FILE] [--keep] [--headed]
//
// The storyboard module default-exports { config?, setup?, steps[], teardown? }.
import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { makeWalkthrough } from './lib/engine.mjs';

const argv = process.argv.slice(2);
const file = argv.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: node run.mjs <storyboard.mjs> [--out FILE] [--keep] [--headed]');
  process.exit(1);
}

const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};

const storyboardPath = path.resolve(file);
const mod = await import(pathToFileURL(storyboardPath).href);
const storyboard = mod.default ?? mod.storyboard;
if (!storyboard?.steps?.length) {
  console.error(`${file} must default-export an object with a non-empty steps[]`);
  process.exit(1);
}

const out = path.resolve(flag('out') ?? 'walkthrough.mp4');
// Create it now: the mux is the very last step, so a missing directory would
// otherwise fail only after paying for the whole TTS + record + compose run.
mkdirSync(path.dirname(out), { recursive: true });

const options = {
  out,
  workDir: path.join(path.dirname(out), '.walkthrough'),
  keepIntermediates: argv.includes('--keep'),
};
if (argv.includes('--headed')) options.headless = false;

const seen = new Set();
for (const s of storyboard.steps) {
  if (!s.id) { console.error('every step needs a unique id'); process.exit(1); }
  if (seen.has(s.id)) { console.error(`duplicate step id: ${s.id}`); process.exit(1); }
  seen.add(s.id);
}

await makeWalkthrough(storyboard, options);
