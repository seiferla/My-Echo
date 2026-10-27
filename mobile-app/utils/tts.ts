import { createAudioPlayer, AudioPlayer, setAudioModeAsync } from 'expo-audio';
import * as Speech from 'expo-speech';
import { BACKEND_STREAM_URL, BACKEND_WARMUP_URL, SENTENCE_STREAMING } from './config';
import { getCachedUri, downloadAndCache } from './ttsCache';
import { authHeaders } from './supabase';
import { splitCompletedSentences } from './split';
import { createSynthQueue } from './synthQueue';

const TAG = '[myEcho][TTS]';
const DOWNLOAD_TIMEOUT_MS = 15_000;
const PLAY_TIMEOUT_MS = 10_000;
// On Android, expo-audio (ExoPlayer) buffers 2.5 s of audio before it starts.
// A short clip downloads faster than that, and streaming would not fill the
// cache. So short texts are downloaded and cached instead.
const SHORT_TEXT_CHARS = 60;

// Keeps playback running when the screen locks or the app goes to the background.
// Without it expo-audio pauses on lock, and a long message would stop in the middle.
// Call once at app start (see app/_layout.tsx).
let _audioModeConfigured = false;
export async function configureAudioSession(): Promise<void> {
    if (_audioModeConfigured) return;
    _audioModeConfigured = true;
    try {
        await setAudioModeAsync({
            playsInSilentMode: true,       // speak in silent mode too
            shouldPlayInBackground: true,  // keep playing when the screen is locked
            interruptionMode: 'doNotMix',  // take audio focus from other apps
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

// Session counter. stopSpeaking() increments it, which cancels every running
// speak() call (also during cache lookup or download): each call remembers its
// session at the start and stops when activeSession has changed.
let activeSession = 0;
let currentPlayer: AudioPlayer | null = null;
// Pre-loaded players for the next sentence (sentence streaming).
// stopSpeaking() releases them if they were never used.
const preparedPlayers = new Set<AudioPlayer>();
// When the last clip ended. Only used to measure the gap between clips.
let lastFinishAt = 0;
let currentAbort: (() => void) | null = null;

/** Keeps the backend's Fish connection warm. Errors are ignored: it is only an optimization. */
export async function warmBackend(): Promise<void> {
    try {
        await fetch(BACKEND_WARMUP_URL, { headers: await authHeaders() });
    } catch {}
}

export function stopSpeaking(): void {
    // 1. New session: every later ensureActive() check fails, also in running downloads.
    activeSession += 1;

    // 2. Abort the active player (if playback already runs).
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

    // 3. Release the pre-loaded players of the next sentences.
    for (const p of preparedPlayers) {
        try { p.remove(); } catch {}
    }
    preparedPlayers.clear();

    // 4. Stop on-device speech.
    Speech.stop();
}

// Returns the TTFA (time to first audio, measured from startMs).
// onFirstAudio runs when the first sound really plays; sentence streaming
// uses it to start the synthesis of the next sentences.
async function playLocalAudio(
    uri: string,
    session: number,
    startMs: number,
    onFirstAudio?: () => void,
    preloaded?: AudioPlayer,
): Promise<number> {
    // Only backend streams need the token, local files do not.
    const headers = uri.startsWith('http') ? await authHeaders() : {};
    return new Promise((resolve, reject) => {
        // Already aborted: do not create a player.
        if (session !== activeSession) {
            reject(new AbortedError());
            return;
        }

        const t0 = Date.now();
        const source = uri.startsWith('http') ? { uri, headers } : { uri };
        const player = preloaded ?? createAudioPlayer(source);
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

        // Called by stopSpeaking(). It must stop and remove the player itself:
        // settle() sets `currentPlayer = null`, so stopSpeaking() would not
        // find the player any more and playback would go on.
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

            // `playing` becomes true when sound really comes out: the best signal for TTFA.
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

function streamUrl(text: string): string {
    return `${BACKEND_STREAM_URL}?text=${encodeURIComponent(text)}`;
}

// Download into the cache, with a timeout.
function downloadWithTimeout(text: string, voice: string, model: string): Promise<string> {
    return Promise.race([
        downloadAndCache(text, streamUrl(text), voice, model),
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

/** Result of one speech output (path + TTFA, see the [METRIC] logs). */
export interface SpeakResult {
    path: SpeakPath;
    /** Time from the speak() call to the first sound (null if nothing was heard). */
    ttfaMs: number | null;
    /** Total time until playback ended. */
    totalMs: number;
    chars: number;
    /** Number of sentences, when the text was spoken sentence by sentence. */
    sentences?: number;
}

/** Logs the [METRIC] line and builds the result of one cloud path. */
function cloudResult(path: SpeakPath, ttfaMs: number, text: string, startMs: number): SpeakResult {
    const totalMs = Date.now() - startMs;
    console.log(`${TAG} [METRIC] path=${path} chars=${text.length} ttfa=${ttfaMs} total=${totalMs}`);
    return { path, ttfaMs, totalMs, chars: text.length };
}

async function speakWithCloud(
    text: string,
    voice: string,
    model: string,
    startMs: number,
    onFirstAudio?: () => void,
): Promise<SpeakResult> {
    // If stopSpeaking() runs during this call, ensureActive() throws.
    const session = activeSession;
    const ensureActive = () => {
        if (session !== activeSession) throw new AbortedError();
    };

    const preview = text.length > 40 ? text.slice(0, 40) + '…' : text;
    console.log(`${TAG} speak "${preview}" (${text.length} chars) voice=${voice || '?'} model=${model || '?'}`);

    const downloadAndPlay = async (path: SpeakPath): Promise<SpeakResult> => {
        const localUri = await downloadWithTimeout(text, voice, model);
        console.log(`${TAG} Downloaded in ${Date.now() - startMs} ms`);
        ensureActive();
        const ttfaMs = await playLocalAudio(localUri, session, startMs, onFirstAudio);
        return cloudResult(path, ttfaMs, text, startMs);
    };

    const cachedUri = await getCachedUri(text, voice, model);
    ensureActive();

    if (cachedUri) {
        console.log(`${TAG} Cache HIT (${Date.now() - startMs} ms lookup)`);
        const ttfaMs = await playLocalAudio(cachedUri, session, startMs, onFirstAudio);
        return cloudResult('cache', ttfaMs, text, startMs);
    }

    // Short text: download and cache instead of streaming (see SHORT_TEXT_CHARS).
    if (text.length <= SHORT_TEXT_CHARS) {
        try {
            console.log(`${TAG} Cache MISS — short text, download+cache`);
            return await downloadAndPlay('download');
        } catch (e) {
            if (e instanceof AbortedError) throw e;
            console.warn(`${TAG} Short-text download failed, falling back to streaming:`, e);
        }
    } else {
        console.log(`${TAG} Cache MISS — streaming from backend`);
    }

    // Play the stream while it arrives. If the player cannot play the chunked
    // response, fall back to download + cache.
    try {
        const ttfaMs = await playLocalAudio(streamUrl(text), session, startMs, onFirstAudio);
        return cloudResult('stream', ttfaMs, text, startMs);
    } catch (e) {
        if (e instanceof AbortedError) throw e;
        console.warn(`${TAG} Streaming failed, falling back to download:`, e);
    }

    ensureActive();
    return downloadAndPlay('stream-fallback-download');
}

// Returns a local audio file for a text, for sharing (e.g. WhatsApp). Plays nothing.
// Uses the same cache as speak() and downloads on a cache miss.
// Without cloud TTS there is no file (expo-speech makes none), so it returns null.
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
        return await downloadWithTimeout(text, voice, model);
    } catch (e) {
        console.warn(`${TAG} getShareableAudioUri failed:`, e);
        return null;
    }
}

// ---- Sentence prefetch ----
// Single sentences are synthesized in the background and stored in the cache
// (cache key = sentence text). Queue rules: see synthQueue.ts.
const synthQueue = createSynthQueue(
    async (text, voice, model) => {
        if (await getCachedUri(text, voice, model)) return;
        await downloadWithTimeout(text, voice, model);
        console.log(`${TAG} Prefetched sentence (${text.length} chars)`);
    },
    (e) => console.warn(`${TAG} Prefetch failed:`, e),
);

export const prefetchSentence = synthQueue.enqueue;

/** If the queue already synthesizes this sentence, wait for it instead of loading it twice. */
async function waitForPendingSynth(sentence: string, voice: string, model: string): Promise<void> {
    const pending = synthQueue.awaitPending(sentence, voice, model);
    if (pending) await pending;
}

// Loads the player for a sentence while the previous one still plays: waits for
// the synthesis, creates the player (loads the file) and leaves it paused.
// Returns null when the sentence is not in the cache (in time).
async function preparePlayer(
    sentence: string,
    voice: string,
    model: string,
    session: number,
): Promise<AudioPlayer | null> {
    await waitForPendingSynth(sentence, voice, model);
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

// Speaks a text with several sentences one by one. Sentence 1 takes the normal
// path (cache/download/stream). When it is audible, the other sentences are
// synthesized in the background, so they are usually cached when needed.
// The TTFA is the one of sentence 1.
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

    // Load the next sentence's player while the current one plays,
    // so there is no audible pause between sentences.
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
                await waitForPendingSynth(sentence, voice, model);
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
                    // Not cached (synthesis failed or too slow): normal path.
                    await waitForPendingSynth(sentence, voice, model);
                    ensureActive();
                    await speakWithCloud(sentence, voice, model, startMs);
                }
            }
        } catch (e) {
            if (e instanceof AbortedError || i === 0) throw e;
            // Failed in the middle: speak the rest on-device, repeat nothing.
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
    // If this value changes before the fallback, a newer speak() call took over.
    const session = activeSession;

    console.log(`${TAG} speak() — useCloud=${useCloud}`);

    if (useCloud) {
        try {
            if (SENTENCE_STREAMING) {
                const sentences = toSentences(text);
                // Whole text already cached (e.g. a saved phrase): normal path.
                if (sentences.length > 1 && !(await getCachedUri(text, voice, model))) {
                    return await speakSentences(sentences, text, voice, model, startMs, onFirstAudio);
                }
            }
            return await speakWithCloud(text, voice, model, startMs, onFirstAudio);
        } catch (error) {
            if (error instanceof AbortedError) {
                // Pass it on. Otherwise handleSpeak() would count an aborted
                // playback as a complete TTS request in the stats.
                console.log(`${TAG} Playback aborted — skipping fallback`);
                throw error;
            }
            console.warn(`${TAG} Cloud TTS failed, falling back to expo-speech:`, error);
        }
    } else {
        console.log(`${TAG} Cloud unavailable — using expo-speech directly`);
    }

    // A newer speak() call may have started while the cloud call failed.
    // Then skip the fallback, so the two do not overlap.
    if (session !== activeSession) {
        console.log(`${TAG} Fallback skipped — newer speak() already active`);
        return { path: 'local', ttfaMs: null, totalMs: Date.now() - startMs, chars: text.length };
    }

    return speakLocal(text, startMs, onFirstAudio);
}
