const { withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo Config-Plugin: setzt die Gradle-Wrapper-Version in
 * android/gradle/wrapper/gradle-wrapper.properties.
 *
 * Grund: android/ ist gitignored und wird bei jedem `expo prebuild` neu aus
 * dem React-Native-Template erzeugt (siehe withReleaseSigning.js). Das
 * Template bringt seine eigene, meist ältere Gradle-Version mit; ein
 * manueller Edit an gradle-wrapper.properties geht beim nächsten Prebuild
 * verloren. expo-build-properties kennt keine Option dafür (nur
 * compileSdkVersion, buildToolsVersion, kotlinVersion, …), daher dieses
 * kleine eigene Plugin nach demselben Muster wie withReleaseSigning.js.
 *
 * Nutzung in app.json:
 *   ["./plugins/withGradleWrapperVersion", { "version": "9.7.1" }]
 */
module.exports = function withGradleWrapperVersion(config, { version } = {}) {
    if (!version) {
        throw new Error('withGradleWrapperVersion: "version" ist erforderlich, z.B. "9.7.1".');
    }

    return withDangerousMod(config, [
        'android',
        (cfg) => {
            const wrapperPath = path.join(
                cfg.modRequest.platformProjectRoot,
                'gradle',
                'wrapper',
                'gradle-wrapper.properties'
            );

            if (!fs.existsSync(wrapperPath)) {
                throw new Error(`withGradleWrapperVersion: ${wrapperPath} nicht gefunden.`);
            }

            const contents = fs.readFileSync(wrapperPath, 'utf8');
            const patched = contents.replace(
                /distributionUrl=.*$/m,
                `distributionUrl=https\\://services.gradle.org/distributions/gradle-${version}-bin.zip`
            );

            if (patched === contents && !contents.includes(`gradle-${version}-bin.zip`)) {
                throw new Error(
                    `withGradleWrapperVersion: distributionUrl-Zeile in ${wrapperPath} nicht gefunden — Format des Templates hat sich geändert.`
                );
            }

            fs.writeFileSync(wrapperPath, patched);
            return cfg;
        },
    ]);
};
