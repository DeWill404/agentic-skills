# Expo CNG — release build path

Applies when `git check-ignore -q android/` succeeds: `android/` is generated,
disposable, and regenerated from `app.json` plus config plugins.

## The rule that shapes everything

**`android/` is an output, so regenerate it on every release build.**

The failure this eliminates: `android/` predating a change to `app.json`, so the
bundle ships the old native config while the config file claims otherwise. It is
invisible — the build succeeds, the app runs, and the wrong permissions reach
the store listing.

Detecting staleness by comparing mtimes across `app.json`, every plugin, and the
generated manifest is fiddly and gets edge cases wrong. Regenerating is one
command and the failure mode stops existing.

**Confirm with the user before every `--clean`.** It deletes `android/`. If
detection were wrong, that destroys hand-written native code.

## Step 1 — Wire release signing (once)

Copy `assets/withReleaseSigning.js` to `plugins/withReleaseSigning.js` in the
project and register it, with a prefix derived from the package name
(`com.dewill.rentmanager` → `RENT_MANAGER`):

```json
"plugins": [
  "expo-router",
  ["./plugins/withReleaseSigning", { "prefix": "RENT_MANAGER" }]
]
```

Then in `~/.gradle/gradle.properties` — global, outside every repo:

```properties
RENT_MANAGER_UPLOAD_STORE_FILE=/absolute/path/to/upload.jks
RENT_MANAGER_UPLOAD_KEY_ALIAS=rent-manager
RENT_MANAGER_UPLOAD_STORE_PASSWORD=...
RENT_MANAGER_UPLOAD_KEY_PASSWORD=...
```

Note the plugin builds its property names as `<prefix>_UPLOAD_*`, so a prefix of
`RENT_MANAGER` yields `RENT_MANAGER_UPLOAD_STORE_FILE`.

Why a plugin rather than editing `android/app/build.gradle`: the edit is
destroyed by the next prebuild. Expo has no first-class alternative —
`expo-build-properties` exposes no signing options, and Expo's own production
guide simply says to edit the generated file. The plugin re-applies the edit
every time.

When the properties are absent the release build falls back to debug signing,
exactly as a stock Expo project does, so a fresh clone still builds. It does not
fail — `verify.sh` is what stops a debug-signed bundle reaching Play, and it
checks the artifact rather than the config.

## Step 2 — Set the versionCode

With no EAS remote versioning, `android.versionCode` in `app.json` is the single
source of truth and must strictly increase per upload:

```json
"android": {
  "package": "com.dewill.rentmanager",
  "versionCode": 2
}
```

Absent, it silently defaults to `1` — fine for a first upload, a rejection for
every one after.

Convention: bump `versionCode` on every upload; bump `version` only when it
means something to a human.

## Step 3 — Build

```bash
rm -rf android/app/build/outputs/bundle/release
npx expo prebuild --platform android --clean
cd android && ./gradlew :app:bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

Deleting the output directory first is not tidiness. A failed build leaves the
*previous* AAB in place, and uploading it ships a stale `versionCode` — caught
by the gate on every release except the first, which is exactly when it is
hardest to notice.

## Step 4 — Verify

```bash
./verify.sh android/app/build/outputs/bundle/release/app-release.aab .play-release.md
```

## Notes

- **No OTA unless `expo-updates` is installed.** Check
  `expo.modules.updates.ENABLED` in the merged manifest. Without it every
  change, JS or native, is a full store release.
- **`expo prebuild` may rewrite `package.json`** to align dependency versions.
  Check `git diff` afterwards rather than assuming only `android/` moved.
- **`eas build` is not required and not used here.** Without Play API access its
  only remaining value is keystore storage, which costs an Expo account, a
  login and a build queue to replace one `keytool` command.
