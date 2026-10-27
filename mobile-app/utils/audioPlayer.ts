import { createAudioPlayer, AudioPlayer, setAudioModeAsync } from 'expo-audio';
import { authHeaders } from './supabase';

// Low-level playback with expo-audio: one player at a time, a session counter
// to cancel running calls, and pre-loaded players for sentence streaming.
// tts.ts decides WHAT to play; this module only plays it.

const TAG = '[myEcho][TTS]';
const PLAY_TIMEOUT_MS = 10_000;

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

export class AbortedError extends Error {
    constructor() { super('Playback aborted'); this.name = 'AbortedError'; }
}

// Session counter. stopPlayback() increments it, which cancels every running
// speak() call (also during cache lookup or download): each call remembers its
// session at the start and stops when activeSession has changed.
let activeSession = 0;
let currentPlayer: AudioPlayer | null = null;
// Pre-loaded players for the next sentence (sentence streaming).
// stopPlayback() releases them if they were never used.
const preparedPlayers = new Set<AudioPlayer>();
// When the last clip ended. Only used to measure the gap between clips.
let lastFinishAt = 0;
let currentAbort: (() => void) | null = null;

export function currentSession(): number {
    return activeSession;
}

/** Throws AbortedError when stopPlayback() ran after `session` started. */
export function ensureSession(session: number): void {
    if (session !== activeSession) throw new AbortedError();
}

/** Cancels all running playback calls and releases every player. */
export function stopPlayback(): void {
    // 1. New session: every later ensureSession() check fails, also in running downloads.
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
}

/** Starts a new gap measurement (see the [METRIC] gap log). */
export function resetGapMeasure(): void {
    lastFinishAt = 0;
}

/** Creates a paused player for a local file. stopPlayback() releases it if it is never played. */
export function createPreparedPlayer(uri: string): AudioPlayer {
    const player = createAudioPlayer({ uri });
    preparedPlayers.add(player);
    return player;
}

// Returns the TTFA (time to first audio, measured from startMs).
// onFirstAudio runs when the first sound really plays; sentence streaming
// uses it to start the synthesis of the next sentences.
export async function playAudio(
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

        // Called by stopPlayback(). It must stop and remove the player itself:
        // settle() sets `currentPlayer = null`, so stopPlayback() would not
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
