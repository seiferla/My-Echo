const { withAppBuildGradle } = require('expo/config-plugins');

/**
 * Expo config plugin: makes android/app/build.gradle ready for CI.
 *
 * The native android/ project is not checked in. It is generated again on every
 * build with `expo prebuild`, so manual build.gradle changes would be lost.
 * This plugin adds them again automatically on every prebuild
 * (locally and in GitHub Actions). It does three things:
 *
 *   1. Release signing: reads the keystore credentials at build time from
 *      android/keystore.properties (exists locally; in CI it is written from
 *      GitHub secrets). If the file is missing, the build falls back to the
 *      debug key and does not fail.
 *
 *   2. versionCode: can be overridden with the env variable ANDROID_VERSION_CODE,
 *      so CI can count every build up monotonically (required to update an
 *      app that is already installed).
 *
 *   3. versionName: can be overridden with ANDROID_VERSION_NAME (e.g. from a
 *      Git tag), otherwise the value from app.json.
 *
 * All changes are idempotent (protected by a marker).
 */

const MARKER = '[withReleaseSigning]';

const PROPS_BLOCK = `
// ${MARKER} Release signing from android/keystore.properties
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
def hasReleaseKeystore = keystorePropertiesFile.exists()
if (hasReleaseKeystore) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
`;

function applySigning(contents) {
    if (contents.includes(MARKER)) return contents;

    // 1. Insert the properties block right before the android { } block.
    contents = contents.replace(/\nandroid\s*\{/, `\n${PROPS_BLOCK}\nandroid {`);

    // 2. Add the release signingConfig after the debug block in signingConfigs { }.
    contents = contents.replace(
        /(signingConfigs\s*\{[\s\S]*?debug\s*\{[\s\S]*?\}\s*\n)(\s*\})/,
        `$1        release {
            if (hasReleaseKeystore) {
                storeFile file(keystoreProperties['storeFile'])
                storePassword keystoreProperties['storePassword']
                keyAlias keystoreProperties['keyAlias']
                keyPassword keystoreProperties['keyPassword']
            }
        }
$2`
    );

    // 3. Switch the release buildType to the release key (fallback: debug).
    contents = contents.replace(
        /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
        `$1signingConfig hasReleaseKeystore ? signingConfigs.release : signingConfigs.debug`
    );

    // 4. versionCode from ANDROID_VERSION_CODE (fallback: original value).
    contents = contents.replace(
        /versionCode\s+(\d+)/,
        'versionCode (System.getenv("ANDROID_VERSION_CODE")?.toInteger() ?: $1)'
    );

    // 5. versionName from ANDROID_VERSION_NAME (fallback: original value).
    contents = contents.replace(
        /versionName\s+"([^"]*)"/,
        'versionName (System.getenv("ANDROID_VERSION_NAME") ?: "$1")'
    );

    return contents;
}

module.exports = function withReleaseSigning(config) {
    return withAppBuildGradle(config, (cfg) => {
        if (cfg.modResults.language !== 'groovy') {
            throw new Error('withReleaseSigning only supports a Groovy build.gradle.');
        }
        cfg.modResults.contents = applySigning(cfg.modResults.contents);
        return cfg;
    });
};