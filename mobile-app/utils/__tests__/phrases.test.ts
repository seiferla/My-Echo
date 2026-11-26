import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { File, Paths } from 'expo-file-system';
import {
    DEFAULT_SETTINGS,
    loadPhraseStore,
    MAX_VISIBLE_PHRASES,
    Phrase,
    PhraseStore,
    prewarmPhrases,
    reorder,
    savePhraseStore,
    syncPhraseStore,
} from '../phrases';
import { getShareableAudioUri } from '../tts';
import { scoped } from '../localUser';
import { backendFetch } from '../backend';
import { BACKEND_PHRASES_URL } from '../config';

// File system as an in-memory map (path → text).
jest.mock('expo-file-system', () => {
    const files = new Map<string, string>();
    class File {
        uri: string;
        constructor(dir: string, name: string) {
            this.uri = `${dir}/${name}`;
        }
        get exists() {
            return files.has(this.uri);
        }
        textSync() {
            return files.get(this.uri) ?? '';
        }
        write(text: string) {
            files.set(this.uri, text);
        }
        delete() {
            files.delete(this.uri);
        }
    }
    return { File, Directory: File, Paths: { document: 'documents' } };
});
jest.mock('../tts', () => ({ getShareableAudioUri: jest.fn() }));
jest.mock('../backend', () => ({ backendFetch: jest.fn() }));

const mockBackendFetch = jest.mocked(backendFetch);
const mockGetAudioUri = jest.mocked(getShareableAudioUri);
const phrasesFile = () => new File(Paths.document, `${scoped('phrases')}.json`);

function store(text: string, updatedAt: number): PhraseStore {
    return {
        phrases: [{ id: `id-${text}`, text, useCount: 0, createdAt: 1 }],
        settings: { visibleCount: 3, instantEnabled: true },
        updatedAt,
    };
}

const jsonResponse = (body: unknown) => ({ json: async () => body }) as unknown as Response;

// GET returns `remote` and runs `duringFetch` first; PUT (push) always works.
function mockBackend(remote: PhraseStore | null, duringFetch?: () => void) {
    mockBackendFetch.mockImplementation(async (_url: string, opts?: { method?: string }) => {
        if (opts?.method === 'PUT') return jsonResponse(null);
        duringFetch?.();
        return jsonResponse(remote);
    });
}

const pushes = () =>
    mockBackendFetch.mock.calls.filter(([, opts]) => opts?.method === 'PUT');

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    phrasesFile().delete();
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('syncPhraseStore', () => {
    it('pushes the local store when the backend has none', async () => {
        const local = store('Ja', 100);
        mockBackend(null);

        expect(await syncPhraseStore(local)).toBeNull();
        expect(pushes()).toEqual([[BACKEND_PHRASES_URL, { method: 'PUT', json: local }]]);
    });

    it('pushes the local store when the backend store is older', async () => {
        const local = store('Ja', 200);
        mockBackend(store('Nein', 100));

        expect(await syncPhraseStore(local)).toBeNull();
        expect(pushes()).toEqual([[BACKEND_PHRASES_URL, { method: 'PUT', json: local }]]);
    });

    it('adopts the backend store when it is newer', async () => {
        const local = store('Ja', 100);
        const remote = store('Nein', 200);
        phrasesFile().write(JSON.stringify(local));
        mockBackend(remote);

        expect(await syncPhraseStore(local)).toEqual(remote);
        expect(await loadPhraseStore()).toEqual(remote);
        expect(pushes()).toEqual([]);
    });

    it('does nothing when both stores have the same time', async () => {
        const local = store('Ja', 100);
        phrasesFile().write(JSON.stringify(local));
        mockBackend(store('Nein', 100));

        expect(await syncPhraseStore(local)).toBeNull();
        expect(await loadPhraseStore()).toEqual(local);
        expect(pushes()).toEqual([]);
    });

    it('keeps a change the user made during the fetch', async () => {
        const local = store('Ja', 100);
        const userChange = store('Danke', 150);
        phrasesFile().write(JSON.stringify(local));
        mockBackend(store('Nein', 200), () => phrasesFile().write(JSON.stringify(userChange)));

        expect(await syncPhraseStore(local)).toBeNull();
        expect(await loadPhraseStore()).toEqual(userChange);
    });
});

// Lets the background push of savePhraseStore (not awaited) finish.
const flushPromises = () => new Promise<void>((resolve) => setImmediate(resolve));

const phrase = (text: string): Phrase => ({ id: `id-${text}`, text, useCount: 0, createdAt: 1 });

describe('loadPhraseStore', () => {
    it('seeds default phrases with updatedAt 0 and saves them when nothing is stored', async () => {
        const result = await loadPhraseStore();

        expect(result.phrases.length).toBeGreaterThan(0);
        expect(result.phrases.map((p) => p.text)).toEqual(expect.arrayContaining(['Ja', 'Nein']));
        expect(result.settings).toEqual(DEFAULT_SETTINGS);
        expect(result.updatedAt).toBe(0);
        expect(new Set(result.phrases.map((p) => p.id)).size).toBe(result.phrases.length);
        // A second load reads the saved file and does not seed again.
        expect(await loadPhraseStore()).toEqual(result);
    });

    it('migrates the old array format to the store format', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(5000);
        phrasesFile().write(
            JSON.stringify([
                { id: 'a', text: 'Ja', useCount: 2, instant: true },
                { text: 'Nein' },
                { id: 'empty', text: '' },
            ])
        );

        const result = await loadPhraseStore();

        expect(result).toEqual({
            phrases: [
                { id: 'a', text: 'Ja', useCount: 2, lastUsedAt: undefined, createdAt: 5000 },
                { id: expect.any(String), text: 'Nein', useCount: 0, lastUsedAt: undefined, createdAt: 5000 },
            ],
            settings: DEFAULT_SETTINGS,
            updatedAt: 5000,
        });
        // The migrated store is saved in the new format.
        expect(JSON.parse(phrasesFile().textSync())).toMatchObject({ version: 2, updatedAt: 5000 });
    });

    it('drops the old per-phrase instant flag when loading a store', async () => {
        phrasesFile().write(
            JSON.stringify({
                phrases: [{ id: 'a', text: 'Ja', useCount: 1, createdAt: 1, instant: false }],
                settings: DEFAULT_SETTINGS,
                updatedAt: 10,
            })
        );

        const result = await loadPhraseStore();

        expect(result.phrases[0]).not.toHaveProperty('instant');
    });

    it.each([
        ['more than the maximum', 99, MAX_VISIBLE_PHRASES],
        ['negative', -2, 0],
        ['a decimal', 1.9, 1],
        ['not a number', 'abc', DEFAULT_SETTINGS.visibleCount],
    ])('normalizes visibleCount when it is %s', async (_name, value, expected) => {
        phrasesFile().write(
            JSON.stringify({ phrases: [], settings: { visibleCount: value }, updatedAt: 1 })
        );

        const result = await loadPhraseStore();

        expect(result.settings.visibleCount).toBe(expected);
    });

    it('uses the default instantEnabled when it is missing and keeps an explicit false', async () => {
        phrasesFile().write(JSON.stringify({ phrases: [], settings: {}, updatedAt: 1 }));
        expect((await loadPhraseStore()).settings.instantEnabled).toBe(true);

        phrasesFile().write(
            JSON.stringify({ phrases: [], settings: { instantEnabled: false }, updatedAt: 1 })
        );
        expect((await loadPhraseStore()).settings.instantEnabled).toBe(false);
    });

    it('returns empty phrases and updatedAt 0 when the store has no phrases or time', async () => {
        phrasesFile().write(JSON.stringify({ phrases: 'broken' }));

        expect(await loadPhraseStore()).toEqual({
            phrases: [],
            settings: DEFAULT_SETTINGS,
            updatedAt: 0,
        });
    });

    it('returns an empty default store when the file is not valid JSON', async () => {
        const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
        phrasesFile().write('{ not json');

        const result = await loadPhraseStore();

        expect(result).toEqual({ phrases: [], settings: DEFAULT_SETTINGS, updatedAt: 0 });
        expect(errorSpy).toHaveBeenCalled();
    });

    it('seeds defaults when reading the file throws', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(File.prototype, 'exists', 'get').mockImplementation(() => {
            throw new Error('disk error');
        });

        const result = await loadPhraseStore();

        expect(result.updatedAt).toBe(0);
        expect(result.phrases.length).toBeGreaterThan(0);
    });

    it('still returns the seeded store when writing the file fails', async () => {
        jest.spyOn(console, 'error').mockImplementation(() => {});
        jest.spyOn(File.prototype, 'write').mockImplementation(() => {
            throw new Error('disk full');
        });

        const result = await loadPhraseStore();

        expect(result.phrases.length).toBeGreaterThan(0);
    });
});

describe('savePhraseStore', () => {
    it('stamps updatedAt, saves locally and pushes the same store to the backend', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(7000);
        mockBackend(null);
        const input = store('Ja', 1);

        await savePhraseStore(input);
        await flushPromises();

        const expected = { ...input, updatedAt: 7000 };
        expect(await loadPhraseStore()).toEqual(expected);
        expect(pushes()).toEqual([[BACKEND_PHRASES_URL, { method: 'PUT', json: expected }]]);
    });

    it('keeps the local save when the backend push fails', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        jest.spyOn(Date, 'now').mockReturnValue(7000);
        mockBackendFetch.mockRejectedValue(new Error('offline'));

        await expect(savePhraseStore(store('Ja', 1))).resolves.toBeUndefined();
        await flushPromises();

        expect((await loadPhraseStore()).updatedAt).toBe(7000);
    });
});

describe('syncPhraseStore errors and remote data', () => {
    it('keeps local phrases and returns null when the backend is offline', async () => {
        jest.spyOn(console, 'warn').mockImplementation(() => {});
        const local = store('Ja', 100);
        phrasesFile().write(JSON.stringify(local));
        mockBackendFetch.mockRejectedValue(new Error('offline'));

        expect(await syncPhraseStore(local)).toBeNull();
        expect(await loadPhraseStore()).toEqual(local);
    });

    it('treats a local store without updatedAt as time 0 and adopts a newer remote', async () => {
        const { updatedAt: _ignored, ...local } = store('Ja', 0);
        phrasesFile().write(JSON.stringify(local));
        mockBackend(store('Nein', 50));

        const result = await syncPhraseStore(local);

        expect(result?.phrases.map((p) => p.text)).toEqual(['Nein']);
        expect(result?.updatedAt).toBe(50);
    });

    it('cleans the adopted remote store (drops empty phrases, clamps settings)', async () => {
        const local = store('Ja', 100);
        phrasesFile().write(JSON.stringify(local));
        const remote = {
            phrases: [phrase('Nein'), { id: 'x', text: '', useCount: 0, createdAt: 1 }],
            settings: { visibleCount: 50, instantEnabled: false },
            updatedAt: 200,
        };
        mockBackendFetch.mockImplementation(async () => jsonResponse(remote));

        const result = await syncPhraseStore(local);

        expect(result?.phrases.map((p) => p.text)).toEqual(['Nein']);
        expect(result?.settings).toEqual({ visibleCount: MAX_VISIBLE_PHRASES, instantEnabled: false });
    });
});

describe('reorder', () => {
    const list = [phrase('a'), phrase('b'), phrase('c')];
    const texts = (l: Phrase[]) => l.map((p) => p.text);

    it('moves a phrase forward and backward', () => {
        expect(texts(reorder(list, 0, 2))).toEqual(['b', 'c', 'a']);
        expect(texts(reorder(list, 2, 0))).toEqual(['c', 'a', 'b']);
    });

    it('does not change the input array', () => {
        reorder(list, 0, 2);

        expect(texts(list)).toEqual(['a', 'b', 'c']);
    });

    it.each([
        ['the same position', 1, 1],
        ['a negative from', -1, 1],
        ['a negative to', 1, -1],
        ['from past the end', 3, 0],
        ['to past the end', 0, 3],
    ])('returns the same list for %s', (_name, from, to) => {
        expect(reorder(list, from, to)).toBe(list);
    });
});

describe('prewarmPhrases', () => {
    it('does nothing when cloud TTS is not available', async () => {
        const result = await prewarmPhrases([phrase('Ja')], false, 'voice', 'model');

        expect(result).toBe(0);
        expect(mockGetAudioUri).not.toHaveBeenCalled();
    });

    it('loads each phrase with the cache flag, voice and model and counts the successes', async () => {
        mockGetAudioUri.mockResolvedValueOnce('file://a.mp3').mockResolvedValueOnce(null);

        const result = await prewarmPhrases([phrase('Ja'), phrase('Nein')], true, 'v1', 'm1');

        expect(result).toBe(1);
        expect(mockGetAudioUri.mock.calls).toEqual([
            ['Ja', true, 'v1', 'm1'],
            ['Nein', true, 'v1', 'm1'],
        ]);
    });

    it('trims the text and skips phrases that are empty after trimming', async () => {
        mockGetAudioUri.mockResolvedValue('file://a.mp3');

        const result = await prewarmPhrases([phrase('  Ja  '), phrase('   ')], true, 'v', 'm');

        expect(result).toBe(1);
        expect(mockGetAudioUri.mock.calls).toEqual([['Ja', true, 'v', 'm']]);
    });

    it('runs one by one, not in parallel', async () => {
        let running = 0;
        let maxRunning = 0;
        mockGetAudioUri.mockImplementation(async () => {
            running += 1;
            maxRunning = Math.max(maxRunning, running);
            await flushPromises();
            running -= 1;
            return 'file://a.mp3';
        });

        await prewarmPhrases([phrase('a'), phrase('b'), phrase('c')], true, 'v', 'm');

        expect(maxRunning).toBe(1);
    });
});
