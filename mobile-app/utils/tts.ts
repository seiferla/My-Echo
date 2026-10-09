import { createAudioPlayer, AudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';
import { BACKEND_STREAM_URL, SENTENCE_STREAMING } from './config';
import { getCachedUri, downloadAndCache } from './ttsCache';
import { splitCompletedSentences } from './split';
import { createSynthQueue } from './synthQueue';

const TAG = '[myEcho][TTS]';
const DOWNLOAD_TIMEOUT_MS = 15_000;
const PLAY_TIMEOUT_MS = 10_000;
// Auf Android wartet expo-audio (ExoPlayer) 2.5 s gepufferten Audios, bevor die
// Wiedergabe startet. Bei kurzen Texten ist der ganze Clip ohnehin schneller da
// als dieser Puffer — Streaming bringt dann keinen Vorteil, füllt aber auch
// nicht den Cache. Für solche Texte direkt herunterladen und cachen.
const SHORT_TEXT_CHARS = 60;

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
// Vorab geladene Player für den jeweils nächsten Satz (Satz-Streaming). Werden
// in stopSpeaking() freigegeben, falls sie nie zum Einsatz kamen.
const preparedPlayers = new Set<AudioPlayer>();
// Zeitpunkt, zu dem der letzte Clip zu Ende war — nur für die Lücken-Messung.
let lastFinishAt = 0;
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

    // 3. Vorab geladene Player des nächsten Satzes freigeben
    for (const p of preparedPlayers) {
        try { p.remove(); } catch {}
    }
    preparedPlayers.clear();

    // 4. Lokale Sprachausgabe stoppen
    Speech.stop();
}

// Gibt die TTFA (Zeit bis zum ersten hörbaren Ton, gemessen ab startMs) zurück.
// onFirstAudio wird genau dann aufgerufen, wenn der erste Ton tatsächlich läuft
// (Satz-Streaming startet darüber die Synthese der Folgesätze).
async function playLocalAudio(
    uri: string,
    session: number,
    startMs: number,
    onFirstAudio?: () => void,
    preloaded?: AudioPlayer,
): Promise<number> {
    return new Promise((resolve, reject) => {
        // Vor Player-Erstellung prüfen — wenn schon abgebrochen, kein Player erstellen
        if (session !== activeSession) {
            reject(new AbortedError());
            return;
        }

        const t0 = Date.now();
        const player = preloaded ?? createAudioPlayer({ uri });
        preparedPlayers.delete(player);
        currentPlayer = player;

        let playbackStarted = false;
        let ttfaLogged = false;
        let ttfaMs = 0;
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
                console.log(`${TAG} Player ready (isLoaded) after ${Date.now() - t0} ms`);
            }

            // `playing` wird true, sobald tatsächlich Ton kommt — das ist der
            // beste Proxy für die TTFA, die wir messen wollen.
            if (status.playing && !ttfaLogged) {
                ttfaLogged = true;
                ttfaMs = Date.now() - startMs;
                if (lastFinishAt) {
                    console.log(`${TAG} [METRIC] gap=${Date.now() - lastFinishAt}ms (previous clip end → next clip audible)`);
                }
                try { onFirstAudio?.(); } catch {}
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
                console.log(`${TAG} Playback finished after ${Date.now() - t0} ms`);
                lastFinishAt = Date.now();
                settle(() => {
                    try { player.remove(); } catch {}
                    resolve(ttfaMs);
                });
            }
        });

        player.play();
    });
}

// Download mit Timeout — dreimal im File gebraucht (kurzer Text, Streaming-
// Fallback bei langem Text, getShareableAudioUri), daher hier gebündelt.
function downloadWithTimeout(
    text: string,
    url: string,
    voice: string,
    model: string,
): Promise<string> {
    return Promise.race([
        downloadAndCache(text, url, voice, model),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Download timeout')), DOWNLOAD_TIMEOUT_MS)
        ),
    ]);
}

export type SpeakPath =
    | 'cache'
    | 'download'
    | 'stream'
    | 'stream-fallback-download'
    | 'local';

/** Ergebnis einer Sprachausgabe (Pfad + TTFA, siehe [METRIC]-Logs). */
export interface SpeakResult {
    path: SpeakPath;
    /** Zeit vom speak()-Eintritt bis zum ersten hörbaren Ton (null wenn nie hörbar). */
    ttfaMs: number | null;
    /** Gesamtdauer bis zum Ende der Wiedergabe. */
    totalMs: number;
    chars: number;
    /** Anzahl der Sätze, wenn satzweise gesprochen wurde (Satz-Streaming). */
    sentences?: number;
}

async function speakWithCloud(
    text: string,
    voice: string,
    model: string,
    startMs: number,
    onFirstAudio?: () => void,
): Promise<SpeakResult> {
    // Session-Snapshot beim Eintritt — stopSpeaking() während dieses Aufrufs
    // ändert activeSession, sodass ensureActive() unten wirft.
    const session = activeSession;
    const ensureActive = () => {
        if (session !== activeSession) throw new AbortedError();
    };

    const preview = text.length > 40 ? text.slice(0, 40) + '…' : text;
    console.log(`${TAG} speak "${preview}" (${text.length} chars) voice=${voice || '?'} model=${model || '?'}`);

    const cachedUri = await getCachedUri(text, voice, model);
    ensureActive();

    if (cachedUri) {
        console.log(`${TAG} Cache HIT (${Date.now() - startMs} ms lookup)`);
        const ttfaMs = await playLocalAudio(cachedUri, session, startMs, onFirstAudio);
        console.log(`${TAG} [METRIC] path=cache chars=${text.length} ttfa=${ttfaMs} total=${Date.now() - startMs}`);
        return { path: 'cache', ttfaMs, totalMs: Date.now() - startMs, chars: text.length };
    }

    const url = `${BACKEND_STREAM_URL}?text=${encodeURIComponent(text)}`;

    // Kurze Texte: direkt herunterladen und cachen statt streamen. ExoPlayer
    // (Android) puffert vor Wiedergabestart ohnehin 2.5 s — bei kurzen Clips
    // ist der Download schneller fertig als dieser Puffer, und der Stream-Pfad
    // würde den Cache nie befüllen.
    if (text.length <= SHORT_TEXT_CHARS) {
        try {
            console.log(`${TAG} Cache MISS — short text, download+cache`);
            const localUri = await downloadWithTimeout(text, url, voice, model);
            console.log(`${TAG} Downloaded in ${Date.now() - startMs} ms`);
            ensureActive();
            const ttfaMs = await playLocalAudio(localUri, session, startMs, onFirstAudio);
            console.log(`${TAG} [METRIC] path=download chars=${text.length} ttfa=${ttfaMs} total=${Date.now() - startMs}`);
            return { path: 'download', ttfaMs, totalMs: Date.now() - startMs, chars: text.length };
        } catch (e) {
            if (e instanceof AbortedError) throw e;
            console.warn(`${TAG} Short-text download failed, falling back to streaming:`, e);
        }
    } else {
        console.log(`${TAG} Cache MISS — streaming from backend`);
    }

    // Progressiv aus dem Stream (TTFA am ersten Chunk). Falls der Player die
    // chunked Response nicht abspielt, auf Download+Cache zurückfallen — nie
    // schlechter als vorher, und der Cache bleibt befüllt.
    try {
        const ttfaMs = await playLocalAudio(url, session, startMs, onFirstAudio);
        console.log(`${TAG} [METRIC] path=stream chars=${text.length} ttfa=${ttfaMs} total=${Date.now() - startMs}`);
        return { path: 'stream', ttfaMs, totalMs: Date.now() - startMs, chars: text.length };
    } catch (e) {
        if (e instanceof AbortedError) throw e;
        console.warn(`${TAG} Streaming failed, falling back to download:`, e);
    }

    ensureActive();
    const localUri = await downloadWithTimeout(text, url, voice, model);
    console.log(`${TAG} Downloaded in ${Date.now() - startMs} ms`);
    ensureActive();
    const ttfaMs = await playLocalAudio(localUri, session, startMs, onFirstAudio);
    console.log(`${TAG} [METRIC] path=stream-fallback-download chars=${text.length} ttfa=${ttfaMs} total=${Date.now() - startMs}`);
    return { path: 'stream-fallback-download', ttfaMs, totalMs: Date.now() - startMs, chars: text.length };
}

// Besorgt die lokale Audio-Datei zu einem Text zum Teilen (z.B. per WhatsApp) —
// spielt nichts ab. Nutzt denselben Cache wie speak(), lädt bei einem Cache-Miss
// aber selbst nach. Ohne Cloud-TTS gibt es keine Datei zum Teilen (expo-speech
// erzeugt keine Audiodatei) → null.
export async function getShareableAudioUri(
    text: string,
    useCloud: boolean,
    voice = '',
    model = '',
): Promise<string | null> {
    if (!useCloud) return null;

    try {
        const cachedUri = await getCachedUri(text, voice, model);
        if (cachedUri) return cachedUri;

        const url = `${BACKEND_STREAM_URL}?text=${encodeURIComponent(text)}`;
        return await downloadWithTimeout(text, url, voice, model);
    } catch (e) {
        console.warn(`${TAG} getShareableAudioUri failed:`, e);
        return null;
    }
}

// ---- Satz-Vorab-Synthese ----
// Einzelne Sätze werden im Hintergrund synthetisiert und im Cache abgelegt
// (Cache-Key = Satztext). Regeln der Warteschlange: siehe synthQueue.ts.
const synthQueue = createSynthQueue(
    async (text, voice, model) => {
        if (await getCachedUri(text, voice, model)) return;
        const url = `${BACKEND_STREAM_URL}?text=${encodeURIComponent(text)}`;
        await downloadWithTimeout(text, url, voice, model);
        console.log(`${TAG} Prefetched sentence (${text.length} chars)`);
    },
    (e) => console.warn(`${TAG} Prefetch failed:`, e),
);

export const prefetchSentence = synthQueue.enqueue;

// Lädt den Player für einen Satz schon, während der vorige noch spielt: wartet
// auf die Synthese, erzeugt den Player (lädt die Datei) und lässt ihn pausiert.
// Liefert null, wenn der Satz nicht (rechtzeitig) im Cache liegt.
async function preparePlayer(
    sentence: string,
    voice: string,
    model: string,
    session: number,
): Promise<AudioPlayer | null> {
    const pending = synthQueue.awaitPending(sentence, voice, model);
    if (pending) await pending;
    if (session !== activeSession) return null;
    const uri = await getCachedUri(sentence, voice, model);
    if (!uri || session !== activeSession) return null;
    const player = createAudioPlayer({ uri });
    preparedPlayers.add(player);
    return player;
}

function toSentences(text: string): string[] {
    const { completed, remainder } = splitCompletedSentences(text);
    return remainder ? [...completed, remainder] : completed;
}

// Spricht einen mehrsätzigen Text satzweise. Satz 1 läuft über den normalen
// Pfad (Cache/Download/Stream); sobald er hörbar ist, werden die übrigen Sätze
// im Hintergrund synthetisiert, sodass sie bei Satzende meist schon im Cache
// liegen. TTFA ist die von Satz 1.
async function speakSentences(
    sentences: string[],
    fullText: string,
    voice: string,
    model: string,
    startMs: number,
    onFirstAudio?: () => void,
): Promise<SpeakResult> {
    const session = activeSession;
    const ensureActive = () => {
        if (session !== activeSession) throw new AbortedError();
    };

    let restStarted = false;
    const startRest = () => {
        if (restStarted) return;
        restStarted = true;
        for (const s of sentences.slice(1)) void prefetchSentence(s, voice, model);
    };

    // Player des nächsten Satzes schon laden, während der aktuelle spielt —
    // vermeidet die hörbare Pause durch Player-Erzeugung beim Satzwechsel.
    let nextPlayer: Promise<AudioPlayer | null> | null = null;
    const prepareNext = (i: number) => {
        if (i < sentences.length) nextPlayer = preparePlayer(sentences[i], voice, model, session);
    };

    let first: SpeakResult | null = null;
    for (let i = 0; i < sentences.length; i++) {
        ensureActive();
        const sentence = sentences[i];

        try {
            if (i === 0) {
                // Läuft schon ein Download für Satz 1 (Tipp-Vorab-Synthese), darauf
                // warten statt doppelt zu laden.
                const pending = synthQueue.awaitPending(sentence, voice, model);
                if (pending) await pending;
                ensureActive();

                first = await speakWithCloud(
                    sentence, voice, model, startMs,
                    () => { startRest(); prepareNext(1); onFirstAudio?.(); },
                );
                startRest();
            } else {
                const player = nextPlayer ? await nextPlayer : null;
                nextPlayer = null;
                ensureActive();
                prepareNext(i + 1);

                if (player) {
                    await playLocalAudio('', session, startMs, undefined, player);
                } else {
                    // Nicht im Cache (Synthese fehlgeschlagen/zu langsam): normaler Pfad.
                    const pending = synthQueue.awaitPending(sentence, voice, model);
                    if (pending) await pending;
                    ensureActive();
                    await speakWithCloud(sentence, voice, model, startMs);
                }
            }
        } catch (e) {
            if (e instanceof AbortedError || i === 0) throw e;
            // Mitten im Text ausgefallen: Rest lokal sprechen, nichts wiederholen.
            console.warn(`${TAG} Sentence ${i + 1} failed, finishing with expo-speech:`, e);
            await speakLocal(sentences.slice(i).join(' '), startMs);
            break;
        }
    }

    return {
        path: first!.path,
        ttfaMs: first!.ttfaMs,
        totalMs: Date.now() - startMs,
        chars: fullText.length,
        sentences: sentences.length,
    };
}

function speakLocal(text: string, startMs: number, onFirstAudio?: () => void): Promise<SpeakResult> {
    return new Promise((resolve) => {
        let ttfaMs: number | null = null;
        const result = (): SpeakResult => ({
            path: 'local',
            ttfaMs,
            totalMs: Date.now() - startMs,
            chars: text.length,
        });
        Speech.speak(text, {
            language: 'de-DE',
            onStart: () => {
                ttfaMs = Date.now() - startMs;
                try { onFirstAudio?.(); } catch {}
            },
            onDone: () => { console.log(`${TAG} expo-speech done`); resolve(result()); },
            onStopped: () => resolve(result()),
            onError: () => resolve(result()),
        });
    });
}

export async function speak(
    text: string,
    useCloud: boolean,
    voice = '',
    model = '',
    onFirstAudio?: () => void,
): Promise<SpeakResult> {
    const startMs = Date.now();
    lastFinishAt = 0;
    stopSpeaking();
    // Session nach stopSpeaking() merken — wenn sich dieser Wert bis zum
    // Fallback ändert, hat eine neuere speak()-Instanz bereits übernommen.
    const session = activeSession;

    console.log(`${TAG} speak() — useCloud=${useCloud}`);

    if (useCloud) {
        try {
            if (SENTENCE_STREAMING) {
                const sentences = toSentences(text);
                // Ganzer Text schon im Cache (z.B. gespeicherte Phrase) → normaler Pfad.
                if (sentences.length > 1 && !(await getCachedUri(text, voice, model))) {
                    return await speakSentences(sentences, text, voice, model, startMs, onFirstAudio);
                }
            }
            return await speakWithCloud(text, voice, model, startMs, onFirstAudio);
        } catch (error) {
            if (error instanceof AbortedError) {
                // An den Aufrufer durchreichen statt hier stillschweigend zu resolven —
                // sonst hält handleSpeak() eine abgebrochene Wiedergabe für abgeschlossen
                // und loggt sie fälschlich als vollständigen TTS-Request in die Stats.
                console.log(`${TAG} Playback aborted — skipping fallback`);
                throw error;
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
        return { path: 'local', ttfaMs: null, totalMs: Date.now() - startMs, chars: text.length };
    }

    return speakLocal(text, startMs, onFirstAudio);
}
