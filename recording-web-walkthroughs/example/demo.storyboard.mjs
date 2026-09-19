// Example storyboard: records a narrated walkthrough of example/demo-app.html.
//
//   node run.mjs example/demo.storyboard.mjs --out example/demo.mp4
//
// Copy this file as the starting point for a real app. The only things that
// change are the URL, the selectors, and the narration.
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APP = pathToFileURL(path.join(import.meta.dirname, 'demo-app.html')).href;

export default {
  title: 'Orbit',
  subtitle: 'filtering and creating issues',

  config: {
    viewport: { width: 1280, height: 800 },
    // Acronyms are spelled phonetically for TTS: `say` reads "CSV" as a word
    // and "500" as "five hundred". Fix it in the text, not by changing voice.
    voice: 'Samantha',
    rate: 190,
  },

  // Navigating here costs zero video seconds, so the recording opens on a
  // loaded application instead of on a blank page.
  setup: async ({ ui }) => {
    await ui.goto(APP, 'table');
  },

  steps: [
    {
      id: 'intro',
      badge: '1 / 5',
      caption: 'Orbit: every open issue in the workspace',
      say: 'Orbit lists every open issue across the workspace.',
      run: async ({ ui }) => {
        await ui.highlight('table');
        await ui.wait(400);
        await ui.clearHighlight();
      },
    },
    {
      id: 'filter',
      badge: '2 / 5',
      caption: 'Filter by title',
      say: 'Typing in the filter narrows the list as you go.',
      run: async ({ ui }) => {
        await ui.type('#q', 'invoice', 60);
        await ui.wait(700);
        await ui.type('#q', '', 0);
      },
    },
    {
      id: 'state',
      badge: '3 / 5',
      caption: 'Filter by state',
      say: 'State is a separate filter. Here, only the open issues.',
      run: async ({ ui }) => {
        await ui.choose('#state', 'open');
        await ui.wait(500);
        await ui.choose('#state', '');
      },
    },
    {
      id: 'create',
      badge: '4 / 5',
      caption: 'Create an issue',
      say: 'New issues are created in a dialog, with a title and an owner.',
      run: async ({ ui, page }) => {
        await ui.click('#new');
        await page.waitForSelector('dialog[open]');
        await ui.type('#t', 'Retry webhook on timeout', 34);
        await ui.type('#o', 'Dana', 40);
        await ui.click('#create');
        await page.waitForSelector('dialog[open]', { state: 'hidden' });
      },
    },
    {
      id: 'result',
      badge: '5 / 5',
      caption: 'It lands at the top of the list',
      say: 'It lands at the top of the list, already open.',
      run: async ({ ui }) => {
        await ui.scrollBy(260);
      },
    },
  ],
};
