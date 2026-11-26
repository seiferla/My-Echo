import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import { getShareableAudioUri, speak, stopSpeaking, warmBackend } from '../tts';
import { downloadAndCache, getCachedUri } from '../ttsCache';
import { authHeaders } from '../supabase';
import {
    AbortedError,
    createPreparedPlayer,
    currentSession,
    ensureSession,
    playAudio,
    stopPlayback,
} from '../audioPlayer';
import { BACKEND_STREAM_URL, BACKEND_WARMUP_URL } from '../config';

// Everything with a native or network side effect is replaced. The real
// split.ts and synthQueue.ts run, so the sentence logic is tested for real.
jest.mock('expo-speech', () => ({ speak: jest.fn(), stop: jest.fn() }));
jest.mock('../ttsCache', () => ({ getCachedUri: jest.fn(), downloadAndCache: jest.fn() }));
jest.mock('../supabase', () => ({ authHeaders: jest.fn() }));
jest.mock('../audioPlayer', () => ({
    AbortedError: class AbortedError extends Error {},
    createPreparedPlayer: jest.fn(),
    currentSession: jest.fn(),
    ensureSession: jest.fn(),
    playAudio: jest.fn(),
    resetGapMeasure: jest.fn(),
    stopPlayback: jest.fn(),
}));

const mockSpeak = jest.mocked(Speech.speak);
const mockGetCachedUri = jest.mocked(getCachedUri);
const mockDownloadAndCache = jest.mocked(downloadAndCache);
const mockAuthHeaders = jest.mocked(authHeaders);
const mockPlayAudio = jest.mocked(playAudio);
const mockStopPlayback = jest.mocked(stopPlayback);

const fakePlayer = {} as unknown as AudioPlayer;
const SHORT = 'Guten Morgen';
// Longer than 60 characters, so it is streamed and not downloaded first.
const LONG = 'Das ist ein langer Satz ohne Satzzeichen, der sicher laenger als sechzig Zeichen ist';

let session: number;
let cache: Set<string>;
const keyOf = (text: string, voice = '', model = '') => `${voice}|${model}|${text}`;

beforeEach(() => {
    jest.useFakeTimers();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});

    session = 0;
    cache = new Set();

    // A small fake cache: a download fills it, a lookup reads it.
    mockGetCachedUri.mockImplementation(async (text, voice, model) =>
        cache.has(keyOf(text, voice, model)) ? `file://${text}` : null,
    );
    mockDownloadAndCache.mockImplementation(async (text, _url, voice, model) => {
        cache.add(keyOf(text, voice, model));
        return `file://${text}`;
    });
    mockAuthHeaders.mockResolvedValue({ Authorization: 'Bearer test' });
    mockPlayAudio.mockImplementation(async (_uri, _session, _start, onFirstAudio) => {
        onFirstAudio?.();
        return 42;
    });
    jest.mocked(createPreparedPlayer).mockReturnValue(fakePlayer);

    // Same session rules as the real audioPlayer: stopping starts a new session.
    jest.mocked(currentSession).mockImplementation(() => session);
    jest.mocked(ensureSession).mockImplementation((s) => {
        if (s !== session) throw new AbortedError();
    });
    mockStopPlayback.mockImplementation(() => {
        session += 1;
    });

    // Fake expo-speech: starts and ends at once.
    mockSpeak.mockImplementation((_text, options) => {
        options?.onStart?.();
        options?.onDone?.();
    });
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    jest.resetAllMocks();
});

describe('warmBackend / stopSpeaking', () => {
    it('calls the warmup URL with the auth headers', async () => {
        const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue({} as Response);

        await warmBackend();

        expect(fetchMock).toHaveBeenCalledWith(BACKEND_WARMUP_URL, {
            headers: { Authorization: 'Bearer test' },
        });
    });

    it('ignores errors, because warmup is only an optimization', async () => {
        jest.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));

        await expect(warmBackend()).resolves.toBeUndefined();
    });

    it('stops the player and expo-speech', () => {
        stopSpeaking();

        expect(mockStopPlayback).toHaveBeenCalledTimes(1);
        expect(Speech.stop).toHaveBeenCalledTimes(1);
    });
});

describe('getShareableAudioUri', () => {
    it('returns null without cloud TTS and does no lookup', async () => {
        expect(await getShareableAudioUri('Hallo', false)).toBeNull();
        expect(mockGetCachedUri).not.toHaveBeenCalled();
    });

    it('returns the cached file when there is one', async () => {
        cache.add(keyOf('Hallo', 'v', 'm'));

        expect(await getShareableAudioUri('Hallo', true, 'v', 'm')).toBe('file://Hallo');
        expect(mockDownloadAndCache).not.toHaveBeenCalled();
    });

    it('downloads on a cache miss', async () => {
        expect(await getShareableAudioUri('Hallo', true, 'v', 'm')).toBe('file://Hallo');
        expect(mockDownloadAndCache).toHaveBeenCalledTimes(1);
    });

    it('returns null when the download fails', async () => {
        mockDownloadAndCache.mockRejectedValue(new Error('500'));

        expect(await getShareableAudioUri('Hallo', true)).toBeNull();
    });
});

describe('speak without cloud', () => {
    it('uses expo-speech with a German voice and reports the local path', async () => {
        const onFirstAudio = jest.fn();

        const result = await speak(SHORT, false, '', '', onFirstAudio);

        expect(mockSpeak).toHaveBeenCalledWith(SHORT, expect.objectContaining({ language: 'de-DE' }));
        expect(result).toMatchObject({ path: 'local', chars: SHORT.length });
        expect(result.ttfaMs).not.toBeNull();
        expect(onFirstAudio).toHaveBeenCalledTimes(1);
        expect(mockPlayAudio).not.toHaveBeenCalled();
    });

    it('still resolves when expo-speech reports an error', async () => {
        mockSpeak.mockImplementation((_text, options) => {
            options?.onError?.(new Error('no voice'));
        });

        await expect(speak(SHORT, false)).resolves.toMatchObject({ path: 'local', ttfaMs: null });
    });
});

describe('speak with cloud (single sentence)', () => {
    it('plays from the cache on a hit', async () => {
        cache.add(keyOf(SHORT, '', ''));

        const result = await speak(SHORT, true);

        expect(result).toMatchObject({ path: 'cache', ttfaMs: 42 });
        expect(mockPlayAudio.mock.calls[0][0]).toBe(`file://${SHORT}`);
        expect(mockDownloadAndCache).not.toHaveBeenCalled();
    });

    it('downloads and caches a short text on a miss', async () => {
        const result = await speak(SHORT, true, 'voice-1', 'model-1');

        expect(result.path).toBe('download');
        expect(mockDownloadAndCache).toHaveBeenCalledWith(
            SHORT,
            `${BACKEND_STREAM_URL}?text=${encodeURIComponent(SHORT)}`,
            'voice-1',
            'model-1',
        );
        expect(mockPlayAudio.mock.calls[0][0]).toBe(`file://${SHORT}`);
    });

    it('streams a long text on a miss', async () => {
        const result = await speak(LONG, true);

        expect(result.path).toBe('stream');
        expect(mockDownloadAndCache).not.toHaveBeenCalled();
        expect(mockPlayAudio.mock.calls[0][0]).toBe(`${BACKEND_STREAM_URL}?text=${encodeURIComponent(LONG)}`);
    });

    it('streams when the short-text download fails', async () => {
        mockDownloadAndCache.mockRejectedValue(new Error('500'));

        const result = await speak(SHORT, true);

        expect(result.path).toBe('stream');
    });

    it('streams when the short-text download times out after 15 s', async () => {
        mockDownloadAndCache.mockImplementation(() => new Promise<string>(() => {}));

        const pending = speak(SHORT, true);
        await jest.advanceTimersByTimeAsync(15_000);

        expect((await pending).path).toBe('stream');
    });

    it('falls back to download when the stream cannot be played', async () => {
        mockPlayAudio.mockImplementationOnce(async () => {
            throw new Error('chunked response not playable');
        });

        const result = await speak(LONG, true);

        expect(result.path).toBe('stream-fallback-download');
        expect(mockDownloadAndCache).toHaveBeenCalledTimes(1);
    });

    it('falls back to expo-speech when every cloud path fails', async () => {
        mockDownloadAndCache.mockRejectedValue(new Error('500'));
        mockPlayAudio.mockRejectedValue(new Error('no audio'));

        const result = await speak(SHORT, true);

        expect(result.path).toBe('local');
        expect(mockSpeak).toHaveBeenCalledTimes(1);
    });

    it('passes an abort on and does not use expo-speech', async () => {
        mockPlayAudio.mockRejectedValue(new AbortedError());
        cache.add(keyOf(SHORT, '', ''));

        await expect(speak(SHORT, true)).rejects.toBeInstanceOf(AbortedError);
        expect(mockSpeak).not.toHaveBeenCalled();
    });

    it('skips the fallback when a newer speak() call took over', async () => {
        mockGetCachedUri.mockImplementation(async () => {
            stopPlayback(); // the newer call starts a new session
            throw new Error('boom');
        });

        const result = await speak(SHORT, true);

        expect(result).toMatchObject({ path: 'local', ttfaMs: null });
        expect(mockSpeak).not.toHaveBeenCalled();
    });

    it('passes onFirstAudio to the player', async () => {
        const onFirstAudio = jest.fn();

        await speak(SHORT, true, '', '', onFirstAudio);

        expect(onFirstAudio).toHaveBeenCalledTimes(1);
    });
});

describe('speak with cloud (several sentences)', () => {
    const TWO = 'Hallo Welt. Wie geht es dir heute?';

    it('plays the first sentence, prefetches the next and plays it from a prepared player', async () => {
        const onFirstAudio = jest.fn();

        const result = await speak(TWO, true, '', '', onFirstAudio);

        expect(result).toMatchObject({ path: 'download', ttfaMs: 42, sentences: 2, chars: TWO.length });
        expect(mockDownloadAndCache.mock.calls.map((c) => c[0])).toEqual(['Hallo Welt.', 'Wie geht es dir heute?']);
        expect(mockPlayAudio).toHaveBeenCalledTimes(2);
        // The second call plays the prepared player, not a URL.
        expect(mockPlayAudio.mock.calls[1][0]).toBe('');
        expect(mockPlayAudio.mock.calls[1][4]).toBe(fakePlayer);
        expect(onFirstAudio).toHaveBeenCalledTimes(1);
    });

    it('uses the normal path when the whole text is already cached', async () => {
        cache.add(keyOf(TWO, '', ''));

        const result = await speak(TWO, true);

        expect(result.path).toBe('cache');
        expect(result.sentences).toBeUndefined();
        expect(mockPlayAudio).toHaveBeenCalledTimes(1);
    });

    it('finishes the rest with expo-speech when a later sentence fails', async () => {
        // Sentence 1 plays fine. For sentence 2 nothing is cached and nothing plays.
        mockDownloadAndCache.mockImplementation(async (text, _url, voice, model) => {
            if (text !== 'Hallo Welt.') throw new Error('500');
            cache.add(keyOf(text, voice, model));
            return `file://${text}`;
        });
        mockPlayAudio.mockImplementation(async (_uri, _session, _start, onFirstAudio) => {
            if (mockPlayAudio.mock.calls.length > 1) throw new Error('no audio');
            onFirstAudio?.();
            return 42;
        });

        const result = await speak(TWO, true);

        expect(mockSpeak).toHaveBeenCalledWith('Wie geht es dir heute?', expect.anything());
        expect(result).toMatchObject({ path: 'download', sentences: 2 });
    });

    it('fails when the first sentence fails in every cloud path', async () => {
        mockDownloadAndCache.mockRejectedValue(new Error('500'));
        mockPlayAudio.mockRejectedValue(new Error('no audio'));

        const result = await speak(TWO, true);

        // The error of sentence 1 is passed up; speak() then speaks the whole text locally.
        expect(result.path).toBe('local');
        expect(mockSpeak).toHaveBeenCalledWith(TWO, expect.anything());
    });
});
