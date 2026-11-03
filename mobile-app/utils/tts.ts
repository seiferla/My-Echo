import type { AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import { BACKEND_STREAM_URL, BACKEND_WARMUP_URL, SENTENCE_STREAMING } from './config';
import { getCachedUri, downloadAndCache } from './ttsCache';
import { authHeaders } from './supabase';
import { splitCompletedSentences } from './split';
import { createSynthQueue } from './synthQueue';
import {
    AbortedError,
    createPreparedPlayer,
    currentSession,
    ensureSession,
    playAudio,
    resetGapMeasure,
    stopPlayback,
} from './audioPlayer';

const TAG = '[myEcho][TTS]';
const DOWNLOAD_TIMEOUT_MS = 15_000;
// On Android, expo-audio (ExoPlayer) buffers 2.5 s of audio before it starts.
// A short clip downloads faster than that, and streaming would not fill the
// cache. So short texts are downloaded and cached instead.
const SHORT_TEXT_CHARS = 60;

/** Keeps the backend TTS connection warm. Errors are ignored: it is only an optimization. */
export async function warmBackend(): Promise<void> {
    try {
        await fetch(BACKEND_WARMUP_URL, { headers: await authHeaders() });
    } catch {}
}

export function stopSpeaking(): void {
    stopPlayback();
    Speech.stop();
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
    const session = currentSession();
    const ensureActive = () => ensureSession(session);

    const preview = text.length > 40 ? text.slice(0, 40) + '…' : text;
    console.log(`${TAG} speak "${preview}" (${text.length} chars) voice=${voice || '?'} model=${model || '?'}`);

    const downloadAndPlay = async (path: SpeakPath): Promise<SpeakResult> => {
        const localUri = await downloadWithTimeout(text, voice, model);
        console.log(`${TAG} Downloaded in ${Date.now() - startMs} ms`);
        ensureActive();
        const ttfaMs = await playAudio(localUri, session, startMs, onFirstAudio);
        return cloudResult(path, ttfaMs, text, startMs);
    };

    const cachedUri = await getCachedUri(text, voice, model);
    ensureActive();

    if (cachedUri) {
        console.log(`${TAG} Cache HIT (${Date.now() - startMs} ms lookup)`);
        const ttfaMs = await playAudio(cachedUri, session, startMs, onFirstAudio);
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
        const ttfaMs = await playAudio(streamUrl(text), session, startMs, onFirstAudio);
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
async function prepareSentencePlayer(
    sentence: string,
    voice: string,
    model: string,
    session: number,
): Promise<AudioPlayer | null> {
    await waitForPendingSynth(sentence, voice, model);
    if (session !== currentSession()) return null;
    const uri = await getCachedUri(sentence, voice, model);
    if (!uri || session !== currentSession()) return null;
    return createPreparedPlayer(uri);
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
    const session = currentSession();
    const ensureActive = () => ensureSession(session);

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
        if (i < sentences.length) nextPlayer = prepareSentencePlayer(sentences[i], voice, model, session);
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
                    await playAudio('', session, startMs, undefined, player);
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
    resetGapMeasure();
    stopSpeaking();
    // If this value changes before the fallback, a newer speak() call took over.
    const session = currentSession();

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
    if (session !== currentSession()) {
        console.log(`${TAG} Fallback skipped — newer speak() already active`);
        return { path: 'local', ttfaMs: null, totalMs: Date.now() - startMs, chars: text.length };
    }

    return speakLocal(text, startMs, onFirstAudio);
}
