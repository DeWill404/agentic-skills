# Play Console — steps as goals

Every step here is a **goal plus a dated hint**, never a click path stated as
fact. The agent cannot see the browser; Google reshuffles this UI every few
months. A remembered path asserted confidently is the failure mode this file
exists to avoid.

## The drift protocol

Present each step as:

```
Step N - <goal in plain words>

Goal: <what must become true, and why it matters>

Likely path (as of <date>):
  <navigation hint>

What do you see? If the wording differs, paste it and I'll look up
the current flow.
```

If the user's report matches the hint, advance — zero cost.

If it does **not** match, **do not improvise a path from memory.** Dispatch a
Sonnet subagent to fetch Google's current help page for that specific step,
re-derive it, then update the hint and its date in this file. That fetch is the
one place this skill spends time to stay correct, and it only spends it when it
is demonstrably wrong.

Hints below were confirmed **2026-08-15**.

---

## First publish

### Step A — Reserve the package name
**Goal:** an app record exists, so the package id is locked to this account.
**Hint:** All apps → Create app. Name, default language, App (not Game), Free.

The package id becomes **permanent** on first bundle upload. Say this out loud
before the user proceeds — it is one of the few genuinely irreversible steps,
and renaming later breaks the upgrade path for everyone already installed.

### Step B — Privacy policy
**Goal:** a public URL stating what the app collects.
**Hint:** Policy → App content → Privacy policy.

Required whenever the app handles personal or sensitive data. A Markdown file on
GitHub Pages is sufficient. It must be truthful about anything leaving the
device — cloud backup and sync count, and are easy to forget because they feel
like a local feature.

### Step C — App content declarations
**Goal:** every item on the App content dashboard is green.
**Hint:** Policy → App content.

**The dashboard is the authority, not a remembered checklist.** Sources
genuinely conflict on which declarations gate the *internal* track specifically:

- **Data safety** — reported exempt for internal-testing-only. Fill it if
  prompted. Declare data that leaves the device as collected **and** transferred.
  Never tick "no data collected" for an app with any cloud feature.
- **Advertising ID** — **does** apply to the internal track, confirmed. Answer
  from the bundle's own manifest, not memory: `verify.sh` warns when `AD_ID` is
  present.
- **Content rating**, **target audience** — ambiguous for internal specifically.
  No authoritative Google source found either way. Do what the dashboard asks.
- **Government apps**, **financial features** — usually No. Tracking one's own
  money is not a financial product.

When a source is ambiguous, say it is ambiguous. Do not resolve it by picking
the confident-sounding answer.

### Step D — Play App Signing
**Goal:** Google holds the app signing key; the local keystore is only an
*upload* key.
**Hint:** offered automatically on first bundle upload; accept it.

This is what makes a lost keystore recoverable. Without it, losing the key ends
the app's upgrade path permanently.

### Step E — First release
**Goal:** a release live on internal testing.
**Hint:** Testing → Internal testing → Create new release → upload the `.aab` →
Save → Review release → Start rollout.

Live in minutes; no review queue on this track. Do not run `verify.sh` after
this — run it *before*, and only reach this step on a clean pass.

**Expect one warning here on a default Expo/RN build:** *"There is no
deobfuscation file associated with this App Bundle."* It is non-blocking, and
`verify.sh` has already settled whether it matters — the obfuscation gate says
either "not obfuscated (R8 off) … can be ignored" or fails the build outright.
Report the gate's verdict rather than re-reasoning about the warning, and do not
suggest enabling R8 to make it go away: minification without keep-rules breaks
reflection-based React Native libraries, and release-only crashes are the worst
thing to introduce at the moment of shipping.

**Play App Signing may already be enrolled** rather than prompted for — the
release screen shows it as *"Releases are signed by Google Play"* under
enhancements. If so, Step D is done; do not go looking for a prompt.

### Step F — Testers
**Goal:** named people can install, and get updates automatically.
**Hint:** Internal testing → Testers tab → Create email list → paste addresses →
save → copy the opt-in URL.

- **100 testers max.**
- **Every address must be a Google account.** A non-Google address fails
  silently — the person simply never sees the app, with no error anywhere.
- The opt-in link is needed once per tester. Later releases reach them through
  normal Play auto-update; no re-invite.

### Step G — Confirm
**Goal:** at least one tester has actually installed.
Only then record the upload in `.play-release.md`. An upload that was rejected,
or a release nobody can see, is not a shipped release.

---

## Update rollout

Steps A–D are done once. A repeat release is:

1. Bump `versionCode` (and `versionName` if it means something to a human)
2. Build
3. `verify.sh` — clean pass required
4. Internal testing → Create new release → upload → Start rollout

Then update `last_uploaded_versionCode` in the state file — **after** the user
confirms the upload was accepted, not at build time. Recording it early makes a
failed upload look shipped and blocks the next build for no reason.

---

## Facts stable enough to state directly

These are structural rather than UI, so they do not rot the same way:

- **Internal testing is exempt** from the 12-testers-for-14-days rule that gates
  production access for personal accounts created after Nov 2023.
- **AAB required**, not APK, on all standard tracks.
- **`versionCode` must strictly increase** against anything previously uploaded
  to any track — including releases later deleted.
- **No review queue** on internal testing; releases go live in minutes.
- **Target API level deadlines** move annually. Do not state the current floor
  from memory — read `target_sdk_floor` from the state file, and re-check it
  when `target_sdk_floor_checked` is over 180 days old.
