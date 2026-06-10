import { createAudioPlayer, AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import { BACKEND_STREAM_URL } from './config';
import { getCachedUri, downloadAndCache } from './ttsCache';

const TAG = '[myEcho][TTS]';
const DOWNLOAD_TIMEOUT_MS = 15_000;
const PLAY_TIMEOUT_MS = 10_000;

class AbortedError extends Error {
    constructor() { super('Playback aborted'); this.name = 'AbortedError'; }
}

let currentPlayer: AudioPlayer | null = null;
let currentAbort: (() => void) | null = null;

export function stopSpeaking(): void {
    if (currentAbort) {
        currentAbort();
        currentAbort = null;
    }
    if (currentPlayer) {
        currentPlayer.pause();
        currentPlayer.remove();
        currentPlayer = null;
    }
    Speech.stop();
}

async function playLocalAudio(uri: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const t0 = Date.now();
        const player = createAudioPlayer({ uri });
        currentPlayer = player;

        let playbackStarted = false;
        let settled = false;

        const settle = (cleanup: () => void) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (currentAbort === abort) currentAbort = null;
            if (currentPlayer === player) currentPlayer = null;
            cleanup();
        };

        const timeout = setTimeout(() => {
            if (!playbackStarted) {
                settle(() => {
                    player.remove();
                    reject(new Error('Playback timeout'));
                });
            }
        }, PLAY_TIMEOUT_MS);

        const abort = () => {
            // Player teardown is performed by stopSpeaking() itself.
            settle(() => reject(new AbortedError()));
        };
        currentAbort = abort;

        player.addListener('playbackStatusUpdate', (status) => {
            if (status.isLoaded && !playbackStarted) {
                playbackStarted = true;
                clearTimeout(timeout);
                console.log(`${TAG} Playback started (${Date.now() - t0} ms)`);
            }

            if (status.didJustFinish) {
                settle(() => {
                    player.remove();
                    resolve();
                });
            }
        });

        player.play();
    });
}

async function speakWithCloud(text: string): Promise<void> {
    const preview = text.length > 40 ? text.slice(0, 40) + '…' : text;
    console.log(`${TAG} speak "${preview}" (${text.length} chars)`);

    // Cache hit — play instantly from local file
    const cachedUri = await getCachedUri(text);
    if (cachedUri) {
        console.log(`${TAG} Cache HIT`);
        await playLocalAudio(cachedUri);
        return;
    }

    // Cache miss — download from backend, cache, then play
    console.log(`${TAG} Cache MISS — downloading from backend`);
    const url = `${BACKEND_STREAM_URL}?text=${encodeURIComponent(text)}`;

    const localUri = await Promise.race([
        downloadAndCache(text, url),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Download timeout')), DOWNLOAD_TIMEOUT_MS)
        ),
    ]);

    await playLocalAudio(localUri);
}

export async function speak(text: string, useCloud: boolean): Promise<void> {
    stopSpeaking();

    console.log(`${TAG} speak() — useCloud=${useCloud}`);

    if (useCloud) {
        try {
            await speakWithCloud(text);
            return;
        } catch (error) {
            if (error instanceof AbortedError) {
                console.log(`${TAG} Playback aborted — skipping fallback`);
                return;
            }
            console.warn(`${TAG} Cloud TTS failed, falling back to expo-speech:`, error);
        }
    } else {
        console.log(`${TAG} Cloud unavailable — using expo-speech directly`);
    }

    return new Promise((resolve) => {
        Speech.speak(text, {
            language: 'de-DE',
            onDone: () => { console.log(`${TAG} expo-speech done`); resolve(); },
            onStopped: resolve,
            onError: () => resolve(),
        });
    });
}
