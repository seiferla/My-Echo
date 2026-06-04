import * as FileSystem from 'expo-file-system/legacy';
import { createAudioPlayer, AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import { BACKEND_WS_URL } from './config';

const TAG = '[myEcho][TTS]';

// Aktuell laufender expo-audio Player — für Stop-Unterstützung.
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
 * Verbindet zum Backend-WebSocket, streamt Audio-Chunks und spielt sie ab.
 * Wirft einen Fehler wenn das Backend nicht erreichbar ist oder antwortet.
 */
async function speakWithCloud(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const t0 = Date.now();
        const preview = text.length > 40 ? text.slice(0, 40) + '…' : text;

        console.log(`${TAG} Connecting → ${BACKEND_WS_URL}`);
        console.log(`${TAG} Text: "${preview}" (${text.length} chars)`);

        const ws = new WebSocket(BACKEND_WS_URL);
        const chunks: string[] = [];

        ws.onopen = () => {
            console.log(`${TAG} WebSocket open (${Date.now() - t0} ms)`);
            ws.send(JSON.stringify({ text }));
            console.log(`${TAG} Request sent`);
        };

        ws.onmessage = (event) => {
            try {
                const parsed = JSON.parse(event.data);
                if (parsed.error) {
                    console.warn(`${TAG} Backend error: ${parsed.error}`);
                    ws.close();
                    reject(new Error(parsed.error));
                    return;
                }
            } catch {
                // Kein JSON → base64 Audio-Chunk
                if (chunks.length === 0) {
                    console.log(`${TAG} First audio chunk received (${Date.now() - t0} ms) ← TTFA`);
                }
                chunks.push(event.data);
            }
        };

        ws.onclose = async () => {
            const totalBytes = chunks.reduce((n, c) => n + c.length, 0);
            console.log(`${TAG} Stream closed — ${chunks.length} chunks, ~${Math.round(totalBytes * 0.75 / 1024)} KB audio (${Date.now() - t0} ms total)`);

            if (chunks.length === 0) {
                reject(new Error('Keine Audio-Daten empfangen'));
                return;
            }

            try {
                const base64Audio = chunks.join('');
                const path = `${FileSystem.cacheDirectory}tts_${Date.now()}.mp3`;

                await FileSystem.writeAsStringAsync(path, base64Audio, {
                    encoding: FileSystem.EncodingType.Base64,
                });
                console.log(`${TAG} Audio written to ${path}`);

                const player = createAudioPlayer({ uri: path });
                currentPlayer = player;
                player.play();
                console.log(`${TAG} Playback started`);

                player.addListener('playbackStatusUpdate', (status) => {
                    if (status.didJustFinish) {
                        console.log(`${TAG} Playback finished`);
                        player.remove();
                        FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
                        currentPlayer = null;
                        resolve();
                    }
                });
            } catch (error) {
                console.error(`${TAG} Playback setup failed:`, error);
                reject(error);
            }
        };

        ws.onerror = (event) => {
            console.error(`${TAG} WebSocket error — Backend nicht erreichbar (${BACKEND_WS_URL})`);
            reject(new Error('Backend nicht erreichbar'));
        };
    });
}

/**
 * Hauptfunktion für Sprachausgabe.
 * Versucht Cloud-TTS, fällt bei Fehler automatisch auf expo-speech zurück.
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
