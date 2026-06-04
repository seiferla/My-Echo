import * as FileSystem from 'expo-file-system/legacy';
import { createAudioPlayer, AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import { BACKEND_WS_URL } from './config';

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
        const ws = new WebSocket(BACKEND_WS_URL);
        const chunks: string[] = [];

        ws.onopen = () => {
            ws.send(JSON.stringify({ text }));
        };

        ws.onmessage = (event) => {
            // Backend sendet entweder base64-Audio-Chunks oder einen Fehler als JSON.
            try {
                const parsed = JSON.parse(event.data);
                if (parsed.error) {
                    ws.close();
                    reject(new Error(parsed.error));
                    return;
                }
            } catch {
                // Kein JSON → base64 Audio-Chunk
                chunks.push(event.data);
            }
        };

        ws.onclose = async () => {
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

                const player = createAudioPlayer({ uri: path });
                currentPlayer = player;
                player.play();

                player.addListener('playbackStatusUpdate', (status) => {
                    if (status.didJustFinish) {
                        player.remove();
                        FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
                        currentPlayer = null;
                        resolve();
                    }
                });
            } catch (error) {
                reject(error);
            }
        };

        ws.onerror = () => {
            reject(new Error('Backend nicht erreichbar'));
        };
    });
}

/**
 * Hauptfunktion für Sprachausgabe.
 * Versucht Cloud-TTS, fällt bei Fehler automatisch auf expo-speech zurück.
 *
 * @param text       Vorzulesender Text
 * @param useCloud   true = Cloud-TTS versuchen, false = direkt expo-speech
 */
export async function speak(text: string, useCloud: boolean): Promise<void> {
    await stopSpeaking();

    if (useCloud) {
        try {
            await speakWithCloud(text);
            return;
        } catch (error) {
            console.log('Cloud TTS fehlgeschlagen, Fallback auf expo-speech:', error);
        }
    }

    // Fallback: expo-speech (lokal, offline-fähig)
    return new Promise((resolve) => {
        Speech.speak(text, {
            language: 'de-DE',
            onDone: resolve,
            onStopped: resolve,
            onError: () => resolve(),
        });
    });
}
