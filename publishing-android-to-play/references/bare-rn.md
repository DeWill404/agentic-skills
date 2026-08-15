# Bare React Native — release build path

Applies when `git check-ignore -q android/` **fails**: `android/` is tracked,
therefore it is source code.

## The rule that shapes everything

**Never regenerate `android/`.** No `expo prebuild`, no `--clean`, ever. Those
files may contain hand-written native code, custom Gradle, or vendored modules
that exist nowhere else. Regenerating destroys them irrecoverably.

Since `android/` is the source of truth, the checks invert relative to CNG:
instead of regenerating to guarantee freshness, read what is actually there and
confirm it is correct.

## Step 1 — Static pre-build checks

Read `android/app/build.gradle` **before** building. Each of these fails in
seconds; discovering them after a four-minute build wastes the build.

**A real release signingConfig exists and is not the debug key.** The trap:

```gradle
buildTypes {
    release {
        signingConfig signingConfigs.debug   // <-- rejected by Play
    }
}
```

The correct shape, reading credentials from Gradle properties:

```gradle
signingConfigs {
    release {
        if (project.hasProperty('MYAPP_UPLOAD_STORE_FILE')) {
            storeFile file(project.property('MYAPP_UPLOAD_STORE_FILE'))
            storePassword project.property('MYAPP_UPLOAD_STORE_PASSWORD')
            keyAlias project.property('MYAPP_UPLOAD_KEY_ALIAS')
            keyPassword project.property('MYAPP_UPLOAD_KEY_PASSWORD')
        }
    }
}
buildTypes {
    release {
        signingConfig signingConfigs.release
    }
}
```

**No passwords in any tracked file.** In a bare project
`android/gradle.properties` **is committed**, and most RN signing tutorials tell
you to put `MYAPP_UPLOAD_STORE_PASSWORD` there. Check it, and check
`build.gradle` for inline literals:

```bash
git ls-files android/ | xargs grep -lE "storePassword|keyPassword" 2>/dev/null
```

Any hit is a blocker, and the password must be treated as compromised —
rotating an upload key is a Play Console support flow, so catching it before the
first push is worth the check.

Credentials belong in `~/.gradle/gradle.properties`, which is global and outside
every repo.

**The keystore path resolves.** A committed `build.gradle` referencing a path
that exists only on someone else's machine builds fine until it does not.

**Working tree clean — warn, do not block.** Building from a dirty tree during a
hotfix is normal. Shipping an artifact matching no commit silently is not.
Record the dirty state in `.play-release.md` so the release stays traceable.

## Step 2 — Set the versionCode

In `android/app/build.gradle`:

```gradle
defaultConfig {
    versionCode 2
    versionName "1.0.1"
}
```

Must strictly increase per upload. In a bare project this is the source of
truth — `app.json` does not feed it, and editing `app.json` here changes
nothing.

Watch for `versionCode` being computed (from a flavour, a git count, or CI). If
it is, read the *bundle's* value after building rather than the source's; the
gate reads the artifact for exactly this reason.

## Step 3 — Build

```bash
rm -rf android/app/build/outputs/bundle/release
cd android && ./gradlew :app:bundleRelease
```

Output: `android/app/build/outputs/bundle/release/app-release.aab`

With product flavours the task and path change — `:app:bundleProdRelease`
produces `outputs/bundle/prodRelease/app-prod-release.aab`. Confirm the flavour
with the user rather than assuming; the package-match gate catches a wrong one,
but only if `package` is recorded in the state file.

## Step 4 — Verify

```bash
./verify.sh android/app/build/outputs/bundle/release/app-release.aab .play-release.md
```

## Notes

- `assets/withReleaseSigning.js` is **not** for bare projects. It is an Expo
  config plugin and only runs during prebuild. Edit `build.gradle` directly —
  here that edit is permanent, which is the whole difference.
- `./gradlew :app:bundleRelease` produces the AAB; `assembleRelease` produces an
  APK, which Play's standard tracks reject.
