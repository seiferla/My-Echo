const { withDangerousMod } = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

/**
 * Expo config plugin: sets the Gradle wrapper version in
 * android/gradle/wrapper/gradle-wrapper.properties.
 *
 * Reason: android/ is gitignored and is created again from the React Native
 * template on every `expo prebuild` (see withReleaseSigning.js). The template
 * brings its own, usually older Gradle version; a manual edit to
 * gradle-wrapper.properties is lost on the next prebuild.
 * expo-build-properties has no option for this (only compileSdkVersion,
 * buildToolsVersion, kotlinVersion, …), so this is a small own plugin
 * with the same pattern as withReleaseSigning.js.
 *
 * Usage in app.json:
 *   ["./plugins/withGradleWrapperVersion", { "version": "9.7.1" }]
 */
module.exports = function withGradleWrapperVersion(config, { version } = {}) {
    if (!version) {
        throw new Error('withGradleWrapperVersion: "version" is required, e.g. "9.7.1".');
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
                throw new Error(`withGradleWrapperVersion: ${wrapperPath} not found.`);
            }

            const contents = fs.readFileSync(wrapperPath, 'utf8');
            const patched = contents.replace(
                /distributionUrl=.*$/m,
                `distributionUrl=https\\://services.gradle.org/distributions/gradle-${version}-bin.zip`
            );

            if (patched === contents && !contents.includes(`gradle-${version}-bin.zip`)) {
                throw new Error(
                    `withGradleWrapperVersion: distributionUrl line not found in ${wrapperPath} — the template format has changed.`
                );
            }

            fs.writeFileSync(wrapperPath, patched);
            return cfg;
        },
    ]);
};
