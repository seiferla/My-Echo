import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

type Module = typeof import('../audioPlayer');

// ---- Fakes ------------------------------------------------------------------------

/** Status fields that audioPlayer.ts reads. */
type Status = { isLoaded?: boolean; playing?: boolean; didJustFinish?: boolean; error?: string };

/** A player that does nothing on its own: the test sends the status updates. */
class MockPlayer {
    listener: ((status: Status) => void) | null = null;
    play = jest.fn();
    pause = jest.fn();
    remove = jest.fn();
    constructor(public source: unknown) {}
    addListener(_event: string, listener: (status: Status) => void) {
        this.listener = listener;
    }
    emit(status: Status) {
        this.listener?.(status);
    }
}

const mockPlayers: MockPlayer[] = [];
const mockSetAudioMode = jest.fn<(mode: unknown) => Promise<void>>();

jest.mock('expo-audio', () => ({
    createAudioPlayer: (source: unknown) => {
        const player = new MockPlayer(source);
        mockPlayers.push(player);
        return player;
    },
    setAudioModeAsync: (mode: unknown) => mockSetAudioMode(mode),
}));
jest.mock('../supabase', () => ({
    authHeaders: async () => ({ Authorization: 'Bearer test' }),
}));

// ---- Helpers ----------------------------------------------------------------------

/** Fresh module state for every test (session counter, current player). */
function load(): Module {
    jest.resetModules();
    return require('../audioPlayer') as Module;
}

const lastPlayer = () => mockPlayers[mockPlayers.length - 1];

/** Lets playAudio() get past its `await authHeaders()` and create the player. */
const flush = () => jest.advanceTimersByTimeAsync(0);

/** Plays a clip from start to end: loaded → playing → finished. */
function playThrough(player: MockPlayer) {
    player.emit({ isLoaded: true });
    player.emit({ playing: true });
    player.emit({ didJustFinish: true });
}

let audio: Module;

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(10_000);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockPlayers.length = 0;
    mockSetAudioMode.mockReset().mockResolvedValue(undefined);
    audio = load();
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

// ---- Tests ------------------------------------------------------------------------

describe('configureAudioSession', () => {
    it('enables background and silent-mode playback once', async () => {
        await audio.configureAudioSession();
        await audio.configureAudioSession();

        expect(mockSetAudioMode).toHaveBeenCalledTimes(1);
        expect(mockSetAudioMode).toHaveBeenCalledWith({
            playsInSilentMode: true,
            shouldPlayInBackground: true,
            interruptionMode: 'doNotMix',
        });
    });

    it('tries again on the next call when it failed', async () => {
        mockSetAudioMode.mockRejectedValueOnce(new Error('denied'));

        await audio.configureAudioSession();
        await audio.configureAudioSession();

        expect(mockSetAudioMode).toHaveBeenCalledTimes(2);
    });
});

describe('sessions', () => {
    it('accepts the current session', () => {
        expect(() => audio.ensureSession(audio.currentSession())).not.toThrow();
    });

    it('rejects a session after stopPlayback()', () => {
        const session = audio.currentSession();

        audio.stopPlayback();

        expect(audio.currentSession()).toBe(session + 1);
        expect(() => audio.ensureSession(session)).toThrow(audio.AbortedError);
    });
});

describe('playAudio', () => {
    describe('source', () => {
        it('plays a local file without auth headers', async () => {
            const done = audio.playAudio('file:///a.mp3', audio.currentSession(), Date.now());
            await flush();

            expect(lastPlayer().source).toEqual({ uri: 'file:///a.mp3' });
            expect(lastPlayer().play).toHaveBeenCalled();
            playThrough(lastPlayer());
            await done;
        });

        it('adds the auth headers to a backend stream', async () => {
            const done = audio.playAudio('https://backend/stream?text=x', audio.currentSession(), Date.now());
            await flush();

            expect(lastPlayer().source).toEqual({
                uri: 'https://backend/stream?text=x',
                headers: { Authorization: 'Bearer test' },
            });
            playThrough(lastPlayer());
            await done;
        });
    });

    describe('normal playback', () => {
        it('resolves with the time to first audio, measured from startMs', async () => {
            const startMs = Date.now() - 100; // e.g. the cache lookup took 100 ms
            const done = audio.playAudio('file:///a.mp3', audio.currentSession(), startMs);
            await flush();
            const player = lastPlayer();

            player.emit({ isLoaded: true });
            jest.advanceTimersByTime(50);
            player.emit({ playing: true });
            jest.advanceTimersByTime(2_000);
            player.emit({ didJustFinish: true });

            await expect(done).resolves.toBe(150);
            expect(player.remove).toHaveBeenCalled();
        });

        it('calls onFirstAudio once, when the sound starts', async () => {
            const onFirstAudio = jest.fn();
            const done = audio.playAudio('file:///a.mp3', audio.currentSession(), Date.now(), onFirstAudio);
            await flush();
            const player = lastPlayer();

            player.emit({ isLoaded: true });
            expect(onFirstAudio).not.toHaveBeenCalled();
            player.emit({ playing: true });
            player.emit({ playing: true });
            player.emit({ didJustFinish: true });
            await done;

            expect(onFirstAudio).toHaveBeenCalledTimes(1);
        });

        it('keeps playing when onFirstAudio throws', async () => {
            const done = audio.playAudio('file:///a.mp3', audio.currentSession(), Date.now(), () => {
                throw new Error('bug in the caller');
            });
            await flush();

            playThrough(lastPlayer());

            await expect(done).resolves.toEqual(expect.any(Number));
        });
    });

    describe('abort', () => {
        it('creates no player when the session is already outdated', async () => {
            const session = audio.currentSession();
            audio.stopPlayback();

            await expect(audio.playAudio('file:///a.mp3', session, Date.now())).rejects.toBeInstanceOf(
                audio.AbortedError,
            );
            expect(mockPlayers).toHaveLength(0);
        });

        it('stops and releases the player on stopPlayback()', async () => {
            const done = audio.playAudio('file:///a.mp3', audio.currentSession(), Date.now());
            await flush();
            const player = lastPlayer();
            player.emit({ isLoaded: true });
            player.emit({ playing: true });

            audio.stopPlayback();

            await expect(done).rejects.toBeInstanceOf(audio.AbortedError);
            expect(player.pause).toHaveBeenCalled();
            expect(player.remove).toHaveBeenCalled();
        });
    });

    describe('errors', () => {
        it('rejects on a player error and releases the player', async () => {
            const done = audio.playAudio('file:///a.mp3', audio.currentSession(), Date.now());
            await flush();
            const player = lastPlayer();

            player.emit({ error: 'decoder failed' });

            await expect(done).rejects.toThrow('expo-audio: decoder failed');
            expect(player.remove).toHaveBeenCalled();
        });

        it('rejects when the clip does not load within 10 s', async () => {
            const done = audio.playAudio('https://backend/stream', audio.currentSession(), Date.now());
            const failed = expect(done).rejects.toThrow('Playback timeout');
            await flush();

            await jest.advanceTimersByTimeAsync(10_000);

            await failed;
            expect(lastPlayer().remove).toHaveBeenCalled();
        });

        it('has no timeout once the clip is loaded', async () => {
            const done = audio.playAudio('file:///a.mp3', audio.currentSession(), Date.now());
            await flush();
            const player = lastPlayer();
            player.emit({ isLoaded: true });

            await jest.advanceTimersByTimeAsync(30_000); // a long message
            player.emit({ playing: true });
            player.emit({ didJustFinish: true });

            await expect(done).resolves.toEqual(expect.any(Number));
        });

        it('settles only once, even when more events follow', async () => {
            const done = audio.playAudio('file:///a.mp3', audio.currentSession(), Date.now());
            await flush();
            const player = lastPlayer();

            playThrough(player);
            player.emit({ error: 'late error' });

            await expect(done).resolves.toEqual(expect.any(Number));
        });
    });
});

describe('prepared players (sentence streaming)', () => {
    it('plays the prepared player instead of creating a new one', async () => {
        const prepared = audio.createPreparedPlayer('file:///next.mp3');
        expect(mockPlayers).toHaveLength(1);

        const done = audio.playAudio('', audio.currentSession(), Date.now(), undefined, prepared);
        await flush();
        playThrough(mockPlayers[0]);
        await done;

        expect(mockPlayers).toHaveLength(1);
        expect(mockPlayers[0].play).toHaveBeenCalled();
    });

    it('releases prepared players that were never played on stopPlayback()', () => {
        audio.createPreparedPlayer('file:///1.mp3');
        audio.createPreparedPlayer('file:///2.mp3');

        audio.stopPlayback();

        expect(mockPlayers.map((p) => p.remove.mock.calls.length)).toEqual([1, 1]);
        expect(mockPlayers.every((p) => p.play.mock.calls.length === 0)).toBe(true);
    });

    it('does not release a prepared player twice after it was played', async () => {
        const prepared = audio.createPreparedPlayer('file:///next.mp3');
        const done = audio.playAudio('', audio.currentSession(), Date.now(), undefined, prepared);
        await flush();
        playThrough(mockPlayers[0]);
        await done;

        audio.stopPlayback();

        expect(mockPlayers[0].remove).toHaveBeenCalledTimes(1);
    });
});
