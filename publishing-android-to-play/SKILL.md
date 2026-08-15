---
name: publishing-android-to-play
description: Use when asked to publish, ship, release, upload, or roll out an Android app to the Google Play Store — including first-time submission, pushing an update to existing testers, setting up an upload keystore or release signing, producing a signed AAB, adding testers to the internal testing track, or diagnosing a Play Console upload rejection. Covers Expo (managed and CNG) and bare React Native projects.
---

# Publishing Android to Play

## Overview

Walks a project from source to a live release on Play's **internal testing** track, one step at a time, verifying each step before moving to the next.

**Core principle: be authoritative where you can verify, advisory where you cannot.**

Everything reachable from a shell — the keystore, the signing config, the bundle's own manifest and signature — is a **hard gate**. Run the check, show the output, refuse to advance on a failure.

Everything inside the Play Console is a **browser the agent cannot see**. Google renames and reshuffles that UI every few months, so stating click paths as fact produces instructions that are confidently wrong. State the *goal*, offer today's path as a hint, and ask what the user actually sees.

That inversion is the whole design. A skill that asserts UI it cannot observe ages badly; one that verifies artifacts it can read does not.

## When to Use

- "Publish this to the Play Store", "ship an update to my testers", "roll out a new version"
- Setting up release signing or an upload keystore for the first time
- A Play Console upload was rejected and the reason is unclear

**Not for:** iOS/App Store, production rollout strategy (staged rollouts, A/B testing), Play API automation via service accounts, or driving the Console with a browser tool. This skill deliberately keeps the human in the browser.

## Requirements

| Tool | Why | Install |
|---|---|---|
| `bundletool` | Reads the AAB's manifest. `aapt2` **cannot** — it rejects an AAB with "could not identify format of APK" | `brew install bundletool` |
| `jarsigner`, `keytool` | Signature verification, keystore creation | any JDK (`brew install openjdk@17`) |
| Android SDK + Gradle | Building | already present in any working Android project |

A Play Console account with the one-time $25 registration paid and identity verification complete. This skill does not cover registration.

## The Loop

### Phase 0 — Detect (silent, no questions)

Read the project and work out three things before saying anything:

**1. Which build path.** The test is git, not config sniffing:

```bash
git check-ignore -q android/ && echo CNG || echo BARE
```

`android/` ignored → generated and disposable → **Expo CNG** (`references/expo-cng.md`).
`android/` tracked → it is source code → **bare RN** (`references/bare-rn.md`).

This test fails safe: an ambiguous project reads as bare, and bare is never regenerated.

**2. Identity.** Package name, `versionCode`, `versionName`, `targetSdk`.

**3. Prior state.** Read `.play-release.md` at the project root if it exists (format below).

### Phase 1 — Route

- No `.play-release.md`, or no `app_created` → **first publish**, roughly a dozen steps.
- State exists and the app is live → **update rollout**, four steps: bump, build, verify, upload.

Do not ask which one. Derive it, then say which you derived and why in one line.

### Phase 2 — Step at a time

For each step:

1. **State the goal** — what must become true, not which button to press.
2. **Say who acts.** If it is shell work, do it. If it needs a human (a browser, a password, a decision), say what you would choose and why, then wait.
3. **Verify.** Run the gate. Show its real output, never a summary of it.
4. **Record.** Update `.play-release.md`.
5. **Advance only on a pass.** A failed gate blocks the next step.

Never batch steps. Never present step N+1 while N is unverified.

## Hard Gates

### Before building

| Gate | Applies | Blocks |
|---|---|---|
| `git check-ignore android/` resolves the path | both | yes — routes everything |
| user confirmed regeneration is safe | CNG | yes — `prebuild --clean` **deletes** `android/` |
| `android/` regenerated this run | CNG | yes |
| `signingConfigs.release` exists and is not the debug key | bare | yes — static read, fails in 2s not 4min |
| keystore path is absolute and outside the project directory | both | yes |
| `keytool -list -keystore <path> -alias <alias>` succeeds | both | yes |
| no passwords in any tracked file | both | yes |
| output directory deleted before building | both | yes |
| working tree clean | bare | warn only |

Two of those need explaining.

**`prebuild --clean` deletes `android/`.** If detection is wrong, that destroys hand-written native code. Confirm out loud before running it, every time.

**`keytool -list` proves the keystore/alias/password triple before a four-minute build**, instead of surfacing as a Gradle error afterwards. It is also what distinguishes "wrong password" from "typed the store password where the key password was wanted".

### After building

```bash
./verify.sh <path-to.aab> <project>/.play-release.md
```

Every gate, exit non-zero on any failure. See `verify.sh` for what each catches. Show the user its output verbatim — the colour-coded PASS/FAIL lines are the evidence, and paraphrasing them hides which gate fired.

## Play Console Steps

Read `references/play-console.md`. It holds each step as a goal plus a dated hint, and the drift protocol:

> If what the user reports does not match the hint, **do not improvise a path**. Fetch Google's current help page via a Sonnet subagent, re-derive the step, and update the hint's date in the reference file.

Console-side facts the skill states as fact, because they are load-bearing:

- **Internal testing is exempt** from the 12-testers-for-14-days rule that gates production for personal accounts.
- **100 testers max**, added as an email list. They need Google accounts.
- **AAB required**, not APK. Releases go live in minutes — no review queue.
- **The App content dashboard is the authority** on which declarations block a rollout. Sources genuinely conflict on whether content rating and target audience gate the internal track specifically. Work the dashboard's list, not a remembered checklist.
- **`AD_ID` does gate internal testing.** If the bundle declares it, the advertising ID declaration must be filled in. `verify.sh` warns when it is present.

## State File

`.play-release.md` at the project root. Gitignore it — add the line if missing. It holds **paths and numbers only, never a password**, so it stays safe even if the ignore rule is lost.

```
# play-release state - com.dewill.rentmanager
track: internal
package: com.dewill.rentmanager
keystore: /Users/me/keystores/rent-manager-upload.jks
key_alias: rent-manager
gradle_prefix: RENT_MANAGER
last_uploaded_versionCode: 3
target_sdk_floor: 36
target_sdk_floor_checked: 2026-08-15
perm: android.permission.INTERNET
perm: android.permission.USE_BIOMETRIC
perm: android.permission.VIBRATE

- [x] keystore generated and backed up
- [x] signing wired
- [x] app created in Console
- [x] declarations green (2026-08-15)
- [ ] release 4 uploaded
```

`verify.sh` reads `package`, `last_uploaded_versionCode`, `target_sdk_floor`, `target_sdk_floor_checked`, and the `perm:` lines. Absent keys downgrade a gate to SKIP rather than inventing a baseline — a first release has no history, and saying so beats guessing.

**Update `last_uploaded_versionCode` only after the user confirms the upload succeeded.** Recording it at build time makes a failed upload look shipped, and the next build then gets blocked for no reason.

**`target_sdk_floor_checked` is a real expiry.** Google raises the floor annually. Past 180 days `verify.sh` warns, and the correct response is to look up Play's current requirement, not to trust the stored number.

## Keystore Guidance

The location is a stored value, never a convention. What matters:

- **Absolute path.** Gradle does not expand `~`, and a relative path resolves against `android/`, which CNG deletes.
- **Outside the repo.** Not "inside but gitignored" — one `git add -f`, one zip of the project folder, and a signing key is somewhere it cannot be retracted from.
- **Backed up off the machine.** A cloud-synced folder is a *good* place: the file is password-protected, and the realistic threat is losing it, not someone stealing it. Keep the password in a password manager, never beside the file.
- **Namespaced Gradle properties.** `~/.gradle/gradle.properties` is global across every app. Two projects both using `MYAPP_UPLOAD_STORE_FILE` would sign one with the other's key. Derive the prefix from the package name.
- **`-validity 10000`** (~27 years). An expired upload key means a support ticket.

Never write passwords into the project. `~/.gradle/gradle.properties` is outside every repo and cannot be committed by accident — unlike `android/gradle.properties`, which **is tracked in bare RN projects** and is where most signing tutorials wrongly tell you to put them.

## Non-Obvious Failures

Every row cost real time to find.

| Symptom | Cause | Fix |
|---|---|---|
| Play rejects the upload as debug-signed, though the build succeeded | Expo's template points the **release** build type at `signingConfigs.debug`. Nothing warns you | `assets/withReleaseSigning.js`, then confirm via `jarsigner`, not the config |
| Signing config vanishes and the next release is debug-signed again | `expo prebuild --clean` regenerates `android/`, discarding hand edits | Config plugin, never a hand edit. `expo-build-properties` has no signing option |
| Permission still ships after being removed from `app.json` | `android/` was stale — built before the config change | In CNG, **always** regenerate before a release build. Never diff mtimes |
| Uploaded artifact is one version behind | A failed build left the previous `app-release.aab` in `build/outputs/` | Delete the output dir before building; existence then proves freshness |
| `aapt2 dump` fails with "could not identify format of APK" | `aapt2` cannot read an AAB at all; the manifest inside is protobuf | `bundletool dump manifest --bundle=x.aab` |
| Bundle "is an APK" check misfires | Both AAB and APK contain `base/dex/classes.dex`, so dex is not a discriminator | AAB has `BundleConfig.pb` at the root; APK has `AndroidManifest.xml` there |
| A re-signed bundle still reports `CN=Android Debug` | `jarsigner` **adds** a signature, it does not replace one | Strip `META-INF/*.SF`, `*.RSA`, `*.DSA` first. A bundle carrying any debug signature must fail |
| `SYSTEM_ALERT_WINDOW` on a store listing | Expo's prebuild template writes it into the **main** manifest, so it merges into release. It is *not* React Native's dev menu — RN dropped that requirement in 2017 | `"blockedPermissions": ["android.permission.SYSTEM_ALERT_WINDOW"]`. RN's `src/debug` manifest re-declares it at higher priority, so the dev menu is unaffected |
| Testers never see the app | A non-Google email on the tester list, silently | Every tester needs a Google account |
| Store listing shows a permission nobody added | A dependency bump pulled it in | The permission diff gate. This is why a baseline is recorded |
| Play warns "no deobfuscation file associated with this App Bundle" and it is unclear whether that matters | Play shows it on **every** bundle without a mapping, and cannot tell "R8 never ran" (benign, and the Expo/RN default) from "R8 ran, map not shipped" (crash reports permanently unreadable for that release) | The obfuscation gate. It reads the artifact: map under `BUNDLE-METADATA/…obfuscation` → fine; otherwise count short class descriptors in `base/dex/*.dex`. Never answer this from the build config |
| Splash screen is three grey circles on a grid | Expo's placeholder. Without `expo-splash-screen` installed **and** configured, prebuild still generates the splash theme and falls back to the logo inside `@expo/prebuild-config`. Nothing errors | Install `expo-splash-screen` and set `image` in its plugin config. The legacy top-level `"splash"` key was removed from the SDK 57 schema — setting it does nothing |

## Verify Before Claiming Success

A build that produced a file is not a release that will be accepted.

- `./verify.sh` exits 0, with every gate PASS or a deliberately-understood SKIP
- the signer CN is **your** key, not `CN=Android Debug` and not a throwaway
- `versionCode` is genuinely higher than what is live
- the permission list is what you expect, item by item

Then, before telling the user to upload: **has this exact release build ever run on hardware?** A release build differs from debug — minification, no dev bundle, real signing. A green gate says the artifact is well-formed, not that the app works. Say so plainly rather than implying the checks cover it.

## Files

- `verify.sh` — the post-build gates; run it, show its output verbatim
- `assets/withReleaseSigning.js` — Expo config plugin, survives `prebuild --clean`
- `references/expo-cng.md` — build path for a gitignored `android/`
- `references/bare-rn.md` — build path for a committed `android/`
- `references/play-console.md` — Console steps as goals, with dated hints
