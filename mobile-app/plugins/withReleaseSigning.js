const { withAppBuildGradle } = require('@expo/config-plugins');

/**
 * Expo Config-Plugin: macht android/app/build.gradle CI-tauglich.
 *
 * Das native android/-Projekt wird nicht eingecheckt, sondern bei jedem Build
 * per `expo prebuild` neu generiert. Manuelle build.gradle-Änderungen würden dabei
 * verloren gehen – dieses Plugin trägt sie deshalb bei jedem prebuild automatisch
 * wieder ein (lokal wie in GitHub Actions). Es erledigt drei Dinge:
 *
 *   1. Release-Signierung: liest Keystore-Zugangsdaten zur Build-Zeit aus
 *      android/keystore.properties (lokal vorhanden, in CI aus GitHub-Secrets
 *      geschrieben). Fehlt die Datei, fällt der Build auf den Debug-Key zurück
 *      und bricht nicht.
 *
 *   2. versionCode: überschreibbar über die Umgebungsvariable ANDROID_VERSION_CODE,
 *      damit CI jeden Build monoton hochzählen kann (Pflicht, um eine bereits
 *      installierte App per Update zu überschreiben).
 *
 *   3. versionName: überschreibbar über ANDROID_VERSION_NAME (z.B. aus einem
 *      Git-Tag), sonst der Wert aus app.json.
 *
 * Alle Änderungen sind idempotent (Marker-geschützt).
 */

const MARKER = '[withReleaseSigning]';

const PROPS_BLOCK = `
// ${MARKER} Release-Signierung aus android/keystore.properties
def keystorePropertiesFile = rootProject.file("keystore.properties")
def keystoreProperties = new Properties()
def hasReleaseKeystore = keystorePropertiesFile.exists()
if (hasReleaseKeystore) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
`;

function applySigning(contents) {
    if (contents.includes(MARKER)) return contents;

    // 1. Properties-Block direkt vor dem android { }-Block einfügen.
    contents = contents.replace(/\nandroid\s*\{/, `\n${PROPS_BLOCK}\nandroid {`);

    // 2. release-signingConfig nach dem debug-Block in signingConfigs { } ergänzen.
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

    // 3. release-buildType auf den Release-Key umstellen (Fallback: debug).
    contents = contents.replace(
        /(buildTypes\s*\{[\s\S]*?release\s*\{[\s\S]*?)signingConfig signingConfigs\.debug/,
        `$1signingConfig hasReleaseKeystore ? signingConfigs.release : signingConfigs.debug`
    );

    // 4. versionCode aus ANDROID_VERSION_CODE (Fallback: ursprünglicher Wert).
    contents = contents.replace(
        /versionCode\s+(\d+)/,
        'versionCode (System.getenv("ANDROID_VERSION_CODE")?.toInteger() ?: $1)'
    );

    // 5. versionName aus ANDROID_VERSION_NAME (Fallback: ursprünglicher Wert).
    contents = contents.replace(
        /versionName\s+"([^"]*)"/,
        'versionName (System.getenv("ANDROID_VERSION_NAME") ?: "$1")'
    );

    return contents;
}

module.exports = function withReleaseSigning(config) {
    return withAppBuildGradle(config, (cfg) => {
        if (cfg.modResults.language !== 'groovy') {
            throw new Error('withReleaseSigning unterstützt nur Groovy-build.gradle.');
        }
        cfg.modResults.contents = applySigning(cfg.modResults.contents);
        return cfg;
    });
};