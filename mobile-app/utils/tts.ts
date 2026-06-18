import { createAudioPlayer, AudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';
import { BACKEND_STREAM_URL } from './config';
import { getCachedUri, downloadAndCache } from './ttsCache';

const TAG = '[myEcho][TTS]';
const DOWNLOAD_TIMEOUT_MS = 15_000;
const PLAY_TIMEOUT_MS = 10_000;

// Konfiguriert die Audio-Session so, dass die Wiedergabe weiterläuft, wenn der
// Bildschirm gesperrt wird oder die App in den Hintergrund geht. Ohne das
// pausiert expo-audio beim Sperren — fatal für eine Kommunikations-App, bei der
// längere Nachrichten zu Ende gesprochen werden müssen.
// Einmalig beim App-Start aufrufen (siehe app/_layout.tsx).
let _audioModeConfigured = false;
export async function configureAudioSession(): Promise<void> {
    if (_audioModeConfigured) return;
    _audioModeConfigured = true;
    try {
        await setAudioModeAsync({
            playsInSilentMode: true,       // auch im Lautlos-Modus sprechen
            shouldPlayInBackground: true,  // weiterspielen bei gesperrtem Screen
            interruptionMode: 'doNotMix',  // Fokus übernehmen, andere Apps ducken
        });
        console.log(`${TAG} Audio session configured for background playback`);
    } catch (e) {
        _audioModeConfigured = false;
        console.warn(`${TAG} Failed to configure audio session:`, e);
    }
}

class AbortedError extends Error {
    constructor() { super('Playback aborted'); this.name = 'AbortedError'; }
}

// Session-Counter — wird in stopSpeaking() inkrementiert und invalidiert
// alle laufenden speak()-Aufrufe (auch während Cache-Lookup oder Download).
// Jeder speak() merkt sich die Session beim Start und verwirft seinen Ablauf,
// sobald activeSession nicht mehr übereinstimmt.
let activeSession = 0;
let currentPlayer: AudioPlayer | null = null;
let currentAbort: (() => void) | null = null;

export function stopSpeaking(): void {
    // 1. Session-Token invalidieren — beendet alles was an einem ensureActive()-
    //    Check vorbeikommt, auch noch laufende Downloads
    activeSession += 1;

    // 2. Aktiven Player abbrechen (falls Wiedergabe schon läuft)
    if (currentAbort) {
        const abort = currentAbort;
        currentAbort = null;
        abort();
    }
    if (currentPlayer) {
        try { currentPlayer.pause(); } catch {}
        try { currentPlayer.remove(); } catch {}
        currentPlayer = null;
    }

    // 3. Lokale Sprachausgabe stoppen
    Speech.stop();
}

async function playLocalAudio(uri: string, session: number): Promise<void> {
    return new Promise((resolve, reject) => {
        // Vor Player-Erstellung prüfen — wenn schon abgebrochen, kein Player erstellen
        if (session !== activeSession) {
            reject(new AbortedError());
            return;
        }

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
                    try { player.remove(); } catch {}
                    reject(new Error('Playback timeout'));
                });
            }
        }, PLAY_TIMEOUT_MS);

        // Wird von stopSpeaking() (oder explizit) aufgerufen. Macht das
        // vollständige Player-Teardown selbst — sonst läuft die Wiedergabe
        // weiter, weil settle() unten `currentPlayer = null` setzt und der
        // anschließende stopSpeaking()-Block dadurch leer durchläuft.
        const abort = () => {
            settle(() => {
                try { player.pause(); } catch {}
                try { player.remove(); } catch {}
                reject(new AbortedError());
            });
        };
        currentAbort = abort;

        player.addListener('playbackStatusUpdate', (status) => {
            if (status.isLoaded && !playbackStarted) {
                playbackStarted = true;
                clearTimeout(timeout);
                console.log(`${TAG} Playback started (${Date.now() - t0} ms)`);
            }

            if (status.error) {
                console.warn(`${TAG} expo-audio error:`, status.error);
                settle(() => {
                    try { player.remove(); } catch {}
                    reject(new Error(`expo-audio: ${status.error}`));
                });
                return;
            }

            if (status.didJustFinish) {
                settle(() => {
                    try { player.remove(); } catch {}
                    resolve();
                });
            }
        });

        player.play();
    });
}

async function speakWithCloud(
    text: string,
    voice: string,
    model: string,
): Promise<void> {
    // Session-Snapshot beim Eintritt — stopSpeaking() während dieses Aufrufs
    // ändert activeSession, sodass ensureActive() unten wirft.
    const session = activeSession;
    const ensureActive = () => {
        if (session !== activeSession) throw new AbortedError();
    };

    const preview = text.length > 40 ? text.slice(0, 40) + '…' : text;
    console.log(`${TAG} speak "${preview}" (${text.length} chars) voice=${voice || '?'} model=${model || '?'}`);

    // Cache-Lookup
    const cachedUri = await getCachedUri(text, voice, model);
    ensureActive();

    if (cachedUri) {
        console.log(`${TAG} Cache HIT`);
        await playLocalAudio(cachedUri, session);
        return;
    }

    // Cache-Miss → Download
    console.log(`${TAG} Cache MISS — downloading from backend`);
    const url = `${BACKEND_STREAM_URL}?text=${encodeURIComponent(text)}`;

    const localUri = await Promise.race([
        downloadAndCache(text, url, voice, model),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Download timeout')), DOWNLOAD_TIMEOUT_MS)
        ),
    ]);
    ensureActive();

    await playLocalAudio(localUri, session);
}

export async function speak(
    text: string,
    useCloud: boolean,
    voice = '',
    model = '',
): Promise<void> {
    stopSpeaking();
    // Session nach stopSpeaking() merken — wenn sich dieser Wert bis zum
    // Fallback ändert, hat eine neuere speak()-Instanz bereits übernommen.
    const session = activeSession;

    console.log(`${TAG} speak() — useCloud=${useCloud}`);

    if (useCloud) {
        try {
            await speakWithCloud(text, voice, model);
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

    // Während dem Cloud-Fehlschlag könnte eine neuere speak()-Instanz
    // stopSpeaking() aufgerufen und ihre eigene Wiedergabe gestartet haben.
    // In dem Fall Fallback überspringen — sonst Overlap mit der neuen Instanz.
    if (session !== activeSession) {
        console.log(`${TAG} Fallback skipped — newer speak() already active`);
        return;
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
