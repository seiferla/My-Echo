import { createAudioPlayer, AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import { BACKEND_STREAM_URL } from './config';

const TAG = '[myEcho][TTS]';
const STREAM_TIMEOUT_MS = 10_000;

// Aktuell laufender Player — für Stop-Unterstützung.
let currentPlayer: AudioPlayer | null = null;

/**
 * Stoppt jede laufende Sprachausgabe (Cloud oder lokal).
 */
export function stopSpeaking(): void {
    if (currentPlayer) {
        currentPlayer.pause();
        currentPlayer.remove();
        currentPlayer = null;
    }
    Speech.stop();
}

/**
 * Streamt Audio direkt vom Backend-HTTP-Endpunkt.
 * ExoPlayer beginnt mit der Wiedergabe sobald genug gebuffert ist —
 * kein Warten auf das komplette Audio, kein Base64, keine Temp-Datei.
 */
async function speakWithCloud(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const t0 = Date.now();
        const preview = text.length > 40 ? text.slice(0, 40) + '…' : text;
        const url = `${BACKEND_STREAM_URL}?text=${encodeURIComponent(text)}`;

        console.log(`${TAG} Streaming → ${BACKEND_STREAM_URL}`);
        console.log(`${TAG} Text: "${preview}" (${text.length} chars)`);

        const player = createAudioPlayer({ uri: url });
        currentPlayer = player;

        let playbackStarted = false;

        // Timeout falls der Stream nie startet (Backend nicht erreichbar etc.)
        const timeout = setTimeout(() => {
            if (!playbackStarted) {
                console.warn(`${TAG} Stream timeout nach ${STREAM_TIMEOUT_MS} ms`);
                player.remove();
                currentPlayer = null;
                reject(new Error('Stream timeout'));
            }
        }, STREAM_TIMEOUT_MS);

        player.addListener('playbackStatusUpdate', (status) => {
            if (status.isLoaded && !playbackStarted) {
                playbackStarted = true;
                clearTimeout(timeout);
                console.log(`${TAG} Playback started (${Date.now() - t0} ms) ← TTFA`);
            }

            if (status.isBuffering) {
                console.log(`${TAG} Buffering...`);
            }

            if (status.didJustFinish) {
                console.log(`${TAG} Playback finished (${Date.now() - t0} ms total)`);
                clearTimeout(timeout);
                player.remove();
                currentPlayer = null;
                resolve();
            }
        });

        player.play();
    });
}

/**
 * Hauptfunktion für Sprachausgabe.
 * Versucht Cloud-TTS via HTTP-Streaming, fällt bei Fehler auf expo-speech zurück.
 */
export async function speak(text: string, useCloud: boolean): Promise<void> {
    stopSpeaking();

    console.log(`${TAG} speak() — useCloud=${useCloud}`);

    if (useCloud) {
        try {
            await speakWithCloud(text);
            return;
        } catch (error) {
            console.warn(`${TAG} Cloud TTS failed, falling back to expo-speech:`, error);
        }
    } else {
        console.log(`${TAG} Cloud unavailable — using expo-speech directly`);
    }

    // Fallback: expo-speech (lokal, offline-fähig)
    console.log(`${TAG} expo-speech fallback started`);
    return new Promise((resolve) => {
        Speech.speak(text, {
            language: 'de-DE',
            onDone: () => { console.log(`${TAG} expo-speech done`); resolve(); },
            onStopped: resolve,
            onError: () => resolve(),
        });
    });
}
