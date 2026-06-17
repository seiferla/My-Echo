# Android Release (CI)

The signed myEcho Android app is built in GitHub Actions, not locally.
The native `android/` project is **deliberately not in the repo** — it is
regenerated in the workflow via `expo prebuild` from `app.json` + `package.json`
(Expo "Continuous Native Generation"). The build runs through Gradle using
**your own keystore**, stored encrypted as a GitHub secret.

Workflow: [`.github/workflows/android-release.yml`](../.github/workflows/android-release.yml)

## One-time setup: GitHub secrets

Under **Repo → Settings → Secrets and variables → Actions → New repository secret**,
create these four secrets:

| Secret                      | Value                                                   |
| --------------------------- | ------------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`   | The keystore (`myecho.keystore`) as base64 (see below)  |
| `ANDROID_KEYSTORE_PASSWORD` | Store password of the keystore                          |
| `ANDROID_KEY_ALIAS`         | Key alias (e.g. `myecho`)                               |
| `ANDROID_KEY_PASSWORD`      | Key password                                            |

Generate the base64 string of the keystore and copy it to the clipboard
(macOS):

```bash
base64 -i android/app/myecho.keystore | pbcopy
```

> ⚠️ The keystore and its passwords must **never** go into the repo (excluded
> via `.gitignore`). Back up the file `android/app/myecho.keystore` separately
> as well (e.g. in a password manager) — if it is lost, an already-installed
> app can no longer be updated in place.

## Triggering a build

**Option A — manual (APK for sideloading):**
GitHub → **Actions** → "Android Release" → **Run workflow** → format `apk` → Start.
After ~15–25 min, download the APK from the run under **Artifacts** and install
it on the phone (enable "Install from unknown sources" first).

**Option B — release via tag (recommended for versions):**

```bash
# Set the version in mobile-app/app.json, then:
git tag v1.0.1
git push origin v1.0.1
```

This builds the app and automatically creates a **GitHub release** with the APK
attached and generated release notes. The `versionName` is taken from the tag
(`v1.0.1` → `1.0.1`).

## Versioning

- **`versionCode`** is set automatically on each CI run to `github.run_number`
  (monotonically increasing — required for updates).
- **`versionName`** comes from the Git tag (for tag builds) or from
  `app.json` → `expo.version` (for manual builds).

Both are injected at build time via environment variables; see the config
plugin [`mobile-app/plugins/withReleaseSigning.js`](../mobile-app/plugins/withReleaseSigning.js).

## Building locally (optional)

```bash
cd mobile-app
npm ci
npx expo prebuild --platform android
# android/keystore.properties + android/app/myecho.keystore must be present
cd android && ./gradlew assembleRelease
# Result: app/build/outputs/apk/release/app-release.apk
```
