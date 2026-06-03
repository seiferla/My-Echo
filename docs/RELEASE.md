# Android-Release (CI)

Die signierte myEcho-Android-App wird in GitHub Actions gebaut, nicht lokal.
Das native `android/`-Projekt liegt **bewusst nicht im Repo** – es wird im
Workflow per `expo prebuild` aus `app.json` + `package.json` neu erzeugt
(Expo „Continuous Native Generation"). Gebaut wird mit Gradle und **deinem
eigenen Keystore**, der verschlüsselt als GitHub-Secret liegt.

Workflow: [`.github/workflows/android-release.yml`](../.github/workflows/android-release.yml)

## Einmalige Einrichtung: GitHub-Secrets

Unter **Repo → Settings → Secrets and variables → Actions → New repository secret**
diese vier Secrets anlegen:

| Secret                     | Wert                                                    |
| -------------------------- | ------------------------------------------------------- |
| `ANDROID_KEYSTORE_BASE64`  | Der Keystore (`myecho.keystore`) als base64 (s. u.)     |
| `ANDROID_KEYSTORE_PASSWORD`| Store-Passwort des Keystores                            |
| `ANDROID_KEY_ALIAS`        | Key-Alias (z. B. `myecho`)                              |
| `ANDROID_KEY_PASSWORD`     | Key-Passwort                                            |

Den base64-String des Keystores erzeugen und in die Zwischenablage kopieren
(macOS):

```bash
base64 -i android/app/myecho.keystore | pbcopy
```

> ⚠️ Der Keystore und seine Passwörter gehören **niemals ins Repo** (per
> `.gitignore` ausgeschlossen). Sichere die Datei `android/app/myecho.keystore`
> zusätzlich separat (z. B. Passwort-Manager) – geht sie verloren, lässt sich
> eine bereits installierte App nicht mehr per Update überschreiben.

## Einen Build auslösen

**Variante A – manuell (APK zum Sideloaden):**
GitHub → **Actions** → „Android Release" → **Run workflow** → Format `apk` → Start.
Nach ~15–25 Min die APK unter dem Lauf bei **Artifacts** herunterladen und aufs
Handy installieren (vorher „Installation aus unbekannten Quellen" erlauben).

**Variante B – Release per Tag (empfohlen für Versionen):**

```bash
# Version in mobile-app/app.json setzen, dann:
git tag v1.0.1
git push origin v1.0.1
```

Das baut die App und legt automatisch ein **GitHub-Release** mit angehängter
APK und generierten Release-Notes an. Der `versionName` wird dabei aus dem Tag
übernommen (`v1.0.1` → `1.0.1`).

## Versionierung

- **`versionCode`** wird pro CI-Lauf automatisch auf `github.run_number`
  gesetzt (monoton steigend – Pflicht für Updates).
- **`versionName`** kommt aus dem Git-Tag (bei Tag-Builds) bzw. aus
  `app.json` → `expo.version` (bei manuellen Builds).

Beides wird zur Build-Zeit über Umgebungsvariablen injiziert; siehe das
Config-Plugin [`mobile-app/plugins/withReleaseSigning.js`](../mobile-app/plugins/withReleaseSigning.js).

## Lokal bauen (optional)

```bash
cd mobile-app
npm ci
npx expo prebuild --platform android
# android/keystore.properties + android/app/myecho.keystore müssen vorhanden sein
cd android && ./gradlew assembleRelease
# Ergebnis: app/build/outputs/apk/release/app-release.apk
```
