/**
 * Expo config plugin: give `android/app/build.gradle` a real release
 * signingConfig that survives `expo prebuild --clean`.
 *
 * Why this exists: in a CNG project `android/` is generated and gitignored, so
 * a hand-edited signingConfigs block is destroyed on the next prebuild. Expo
 * offers no first-class alternative - `expo-build-properties` exposes no
 * signing options, and Expo's own production guide simply tells you to edit the
 * generated file. This re-applies the edit on every prebuild instead.
 *
 * Credentials are read from Gradle properties, which live in
 * ~/.gradle/gradle.properties - global, outside every repo, impossible to
 * commit by accident. Nothing secret is written into the project.
 *
 * Usage in app.json (prefix is namespaced so two apps never collide in the
 * one global gradle.properties):
 *
 *   "plugins": [
 *     ["./plugins/withReleaseSigning", { "prefix": "RENT_MANAGER" }]
 *   ]
 *
 * Then in ~/.gradle/gradle.properties:
 *
 *   RENT_MANAGER_UPLOAD_STORE_FILE=/absolute/path/to/upload.jks
 *   RENT_MANAGER_UPLOAD_KEY_ALIAS=your-alias
 *   RENT_MANAGER_UPLOAD_STORE_PASSWORD=...
 *   RENT_MANAGER_UPLOAD_KEY_PASSWORD=...
 *
 * When those properties are absent the release build falls back to the debug
 * signing config, exactly as a stock Expo project does, so a fresh clone still
 * builds. It does NOT fail the build - verify.sh is what stops a debug-signed
 * bundle reaching Play, and it checks the artifact rather than the config.
 */

const { withAppBuildGradle } = require('@expo/config-plugins');

const MARKER = '// managed by publishing-android-to-play';

module.exports = function withReleaseSigning(config, { prefix = 'UPLOAD' } = {}) {
  const P = `${prefix}_UPLOAD`;

  return withAppBuildGradle(config, cfg => {
    if (cfg.modResults.language !== 'groovy') {
      throw new Error('withReleaseSigning: app/build.gradle is not Groovy; this plugin only handles the standard Expo template.');
    }

    let src = cfg.modResults.contents;
    if (src.includes(MARKER)) return cfg;

    // Point the release build type at our config when the properties exist.
    // The regex starts at `release {` so it cannot match the debug block's
    // identical line, which appears earlier in the template. Do this BEFORE
    // inserting signingConfigs.release below, or that block's own `release {`
    // becomes an earlier match.
    const releaseSigning = /(\brelease\s*\{[\s\S]*?)signingConfig\s+signingConfigs\.debug/;
    if (!releaseSigning.test(src)) {
      throw new Error(
        'withReleaseSigning: could not find `signingConfig signingConfigs.debug` inside the release build type. ' +
        'The Expo template changed - update this plugin rather than editing android/ by hand.',
      );
    }
    src = src.replace(
      releaseSigning,
      `$1signingConfig project.hasProperty('${P}_STORE_FILE') ? signingConfigs.release : signingConfigs.debug  ${MARKER}`,
    );

    // Add signingConfigs.release. Guarded by hasProperty so a machine without
    // the credentials still evaluates the block without throwing.
    const block = `    signingConfigs {
        release {  ${MARKER}
            if (project.hasProperty('${P}_STORE_FILE')) {
                storeFile file(project.property('${P}_STORE_FILE'))
                storePassword project.property('${P}_STORE_PASSWORD')
                keyAlias project.property('${P}_KEY_ALIAS')
                keyPassword project.property('${P}_KEY_PASSWORD')
            }
        }
`;
    if (!/\bsigningConfigs\s*\{/.test(src)) {
      throw new Error('withReleaseSigning: no signingConfigs block found in app/build.gradle.');
    }
    src = src.replace(/    signingConfigs\s*\{\n/, block);

    cfg.modResults.contents = src;
    return cfg;
  });
};
