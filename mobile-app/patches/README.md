# Patches

## expo-audio+57.0.5.patch

Lowers the ExoPlayer (Media3) start buffer on Android in `expo-audio`'s
`AudioPlayer.kt`. By default, Media3's `DefaultLoadControl` waits for
~2.5 s of buffered audio before playback starts. For streamed TTS audio
that delay is very noticeable, so this patch adds two constants
(`BUFFER_FOR_PLAYBACK_MS = 500`, `BUFFER_FOR_PLAYBACK_AFTER_REBUFFER_MS = 1000`)
and always applies a custom `LoadControl`, so playback starts after
~0.5 s of buffered audio instead.

The patch is applied automatically via the `postinstall` script in
`package.json` (`patch-package`), so it re-applies after every
`npm install`.

## Refreshing after an expo-audio version bump

1. Update `expo-audio` in `package.json` / run the dependency bump.
2. Re-apply the same edit to `node_modules/expo-audio/android/src/main/java/expo/modules/audio/AudioPlayer.kt`
   (see the diff in `expo-audio+<old-version>.patch` for reference).
3. Run `npx patch-package expo-audio` to regenerate the patch file for
   the new version.
4. `postinstall` fails loudly if the patch no longer applies cleanly,
   so a broken patch is caught right away instead of silently skipped.
