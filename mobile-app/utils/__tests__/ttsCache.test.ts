import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

type Cache = typeof import('../ttsCache');

const MB = 1024 * 1024;

// In-memory file system. It lives outside the module registry, so the files
// survive jest.resetModules(): a new module instance can "restart the app" and
// read the index of the old one.
const mockFs = {
    files: new Map<string, { size: number; text: string }>(),
    dirs: new Set<string>(),
};
// Controls for the fake download.
const mockCtl = {
    user: 'u1',
    fileSize: 1000,
    failDownload: false,
    gate: null as null | Promise<void>,
    downloads: [] as { url: string; uri: string; options: unknown }[],
};

jest.mock('expo-file-system', () => {
    const base = (dir: string | { uri: string }) => (typeof dir === 'string' ? dir : dir.uri);
    class Directory {
        uri: string;
        constructor(parent: string | { uri: string }, name: string) {
            this.uri = `${base(parent)}/${name}`;
        }
        get exists() {
            return mockFs.dirs.has(this.uri);
        }
        create() {
            mockFs.dirs.add(this.uri);
        }
        delete() {
            mockFs.dirs.delete(this.uri);
            for (const key of [...mockFs.files.keys()]) {
                if (key.startsWith(`${this.uri}/`)) mockFs.files.delete(key);
            }
        }
    }
    class File {
        uri: string;
        constructor(dir: string | { uri: string }, name: string) {
            this.uri = `${base(dir)}/${name}`;
        }
        get exists() {
            return mockFs.files.has(this.uri);
        }
        get size() {
            return mockFs.files.get(this.uri)?.size ?? 0;
        }
        textSync() {
            return mockFs.files.get(this.uri)?.text ?? '';
        }
        write(text: string) {
            mockFs.files.set(this.uri, { size: text.length, text });
        }
        delete() {
            mockFs.files.delete(this.uri);
        }
        static async downloadFileAsync(url: string, dest: File, options: unknown) {
            mockCtl.downloads.push({ url, uri: dest.uri, options });
            if (mockCtl.gate) await mockCtl.gate;
            if (mockCtl.failDownload) {
                mockFs.files.set(dest.uri, { size: 5, text: '' }); // partial bytes
                throw new Error('UnableToDownload');
            }
            mockFs.files.set(dest.uri, { size: mockCtl.fileSize, text: '' });
            return dest;
        }
    }
    return { File, Directory, Paths: { document: 'documents' } };
});
jest.mock('../supabase', () => ({
    authHeaders: async () => ({ Authorization: 'Bearer test' }),
}));
jest.mock('../localUser', () => ({
    scoped: (name: string) => `${name}.${mockCtl.user}`,
}));

const indexPath = (user = 'u1') => `documents/tts-cache.${user}/index.json`;

// A fresh module instance has fresh state (like a restarted app).
// require() is used because Jest has no dynamic import() without an ESM flag.
function loadCache(): Cache {
    jest.resetModules();
    return require('../ttsCache') as Cache;
}

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(0);
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockFs.files.clear();
    mockFs.dirs.clear();
    mockCtl.user = 'u1';
    mockCtl.fileSize = 1000;
    mockCtl.failDownload = false;
    mockCtl.gate = null;
    mockCtl.downloads = [];
});

afterEach(() => {
    jest.dontMock('react-native');
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe('hit and miss', () => {
    it('misses before anything is cached', async () => {
        const cache = loadCache();

        expect(await cache.getCachedUri('Hallo')).toBeNull();
        expect(await cache.getCacheStats()).toMatchObject({ entries: 0, hits: 0, misses: 1 });
    });

    it('downloads with auth headers, then hits', async () => {
        const cache = loadCache();

        const uri = await cache.downloadAndCache('Hallo', 'https://backend/tts?text=Hallo');

        expect(mockCtl.downloads).toEqual([
            {
                url: 'https://backend/tts?text=Hallo',
                uri,
                options: { idempotent: true, headers: { Authorization: 'Bearer test' } },
            },
        ]);
        expect(await cache.getCachedUri('Hallo')).toBe(uri);
        expect(await cache.getCacheStats()).toMatchObject({ entries: 1, hits: 1, misses: 0, hitRatePct: 100 });
    });

    it('keeps entries apart per voice and model', async () => {
        const cache = loadCache();
        await cache.downloadAndCache('Hallo', 'u', 'voice-a', 'model-1');

        expect(await cache.getCachedUri('Hallo', 'voice-a', 'model-1')).not.toBeNull();
        expect(await cache.getCachedUri('Hallo', 'voice-b', 'model-1')).toBeNull();
        expect(await cache.getCachedUri('Hallo', 'voice-a', 'model-2')).toBeNull();
    });

    it('rounds the hit rate', async () => {
        const cache = loadCache();
        await cache.downloadAndCache('A', 'u');
        await cache.getCachedUri('A'); // hit
        await cache.getCachedUri('B'); // miss
        await cache.getCachedUri('C'); // miss

        expect((await cache.getCacheStats()).hitRatePct).toBe(33);
    });
});

describe('damaged cache files', () => {
    it('treats an empty file as a miss and removes it', async () => {
        const cache = loadCache();
        mockCtl.fileSize = 0;
        const uri = await cache.downloadAndCache('Hallo', 'u');

        expect(await cache.getCachedUri('Hallo')).toBeNull();
        expect(mockFs.files.has(uri)).toBe(false);
        expect((await cache.getCacheStats()).entries).toBe(0);
    });

    it('treats a missing file as a miss', async () => {
        const cache = loadCache();
        const uri = await cache.downloadAndCache('Hallo', 'u');
        mockFs.files.delete(uri);

        expect(await cache.getCachedUri('Hallo')).toBeNull();
        expect((await cache.getCacheStats()).entries).toBe(0);
    });
});

describe('downloads', () => {
    it('removes partial bytes and does not cache when the download fails', async () => {
        const cache = loadCache();
        mockCtl.failDownload = true;

        await expect(cache.downloadAndCache('Hallo', 'u')).rejects.toThrow('UnableToDownload');

        expect([...mockFs.files.keys()].filter((k) => k.endsWith('.mp3'))).toEqual([]);
        expect((await cache.getCacheStats()).entries).toBe(0);

        // A failed download does not block the next try.
        mockCtl.failDownload = false;
        await expect(cache.downloadAndCache('Hallo', 'u')).resolves.toMatch(/\.mp3$/);
    });

    it('shares one download between concurrent requests', async () => {
        const cache = loadCache();
        let release!: () => void;
        mockCtl.gate = new Promise<void>((resolve) => {
            release = resolve;
        });

        const first = cache.downloadAndCache('Hallo', 'u');
        const second = cache.downloadAndCache('Hallo', 'u');
        await jest.advanceTimersByTimeAsync(0);
        release();

        expect(await first).toBe(await second);
        expect(mockCtl.downloads).toHaveLength(1);
    });

    it('drops the result when the cache is cleared during the download', async () => {
        const cache = loadCache();
        let release!: () => void;
        mockCtl.gate = new Promise<void>((resolve) => {
            release = resolve;
        });

        const download = cache.downloadAndCache('Hallo', 'u');
        const failed = expect(download).rejects.toThrow('Cache cleared during download');
        await jest.advanceTimersByTimeAsync(0);
        await cache.clearCache();
        release();
        await failed;

        expect((await cache.getCacheStats()).entries).toBe(0);
        expect([...mockFs.files.keys()].filter((k) => k.endsWith('.mp3'))).toEqual([]);
    });
});

describe('LRU eviction', () => {
    it('evicts the least recently used entries above 100 MB, down to 80 MB', async () => {
        const cache = loadCache();
        mockCtl.fileSize = 30 * MB;
        const tick = () => jest.advanceTimersByTime(10);

        await cache.downloadAndCache('A', 'u'); tick();
        await cache.downloadAndCache('B', 'u'); tick();
        await cache.downloadAndCache('C', 'u'); tick();
        await cache.getCachedUri('A'); tick(); // A is used again, so B is the oldest
        await cache.downloadAndCache('D', 'u'); // 120 MB > 100 MB

        const stats = await cache.getCacheStats();
        expect(stats.entries).toBe(2);
        expect(stats.totalSizeMB).toBe(60);
        expect(await cache.getCachedUri('A')).not.toBeNull();
        expect(await cache.getCachedUri('D')).not.toBeNull();
        expect(await cache.getCachedUri('B')).toBeNull();
        expect(await cache.getCachedUri('C')).toBeNull();
    });

    it('keeps everything below the limit', async () => {
        const cache = loadCache();
        mockCtl.fileSize = 30 * MB;
        await cache.downloadAndCache('A', 'u');
        await cache.downloadAndCache('B', 'u');

        expect((await cache.getCacheStats()).entries).toBe(2);
    });
});

describe('persistence', () => {
    it('writes the index after the debounce and a restart reads it', async () => {
        const cache = loadCache();
        const uri = await cache.downloadAndCache('Hallo', 'u');

        expect(mockFs.files.has(indexPath())).toBe(false); // not yet, debounced
        jest.advanceTimersByTime(500);
        expect(mockFs.files.has(indexPath())).toBe(true);

        const restarted = loadCache();
        expect(await restarted.getCachedUri('Hallo')).toBe(uri);
    });

    it.each([
        ['broken JSON', 'not json'],
        ['an unknown version', JSON.stringify({ version: 2, entries: { x: {} }, totalSize: 1, hits: 5, misses: 5 })],
    ])('starts empty with %s in the index', async (_label, text) => {
        mockFs.dirs.add('documents/tts-cache.u1');
        mockFs.files.set(indexPath(), { size: text.length, text });
        const cache = loadCache();

        expect(await cache.getCacheStats()).toMatchObject({ entries: 0, hits: 0, misses: 0 });
    });
});

describe('clearCache', () => {
    it('removes all files and resets the stats', async () => {
        const cache = loadCache();
        const uri = await cache.downloadAndCache('Hallo', 'u');
        await cache.getCachedUri('Hallo');

        await cache.clearCache();

        expect(mockFs.files.has(uri)).toBe(false);
        expect(await cache.getCacheStats()).toMatchObject({ entries: 0, totalSizeMB: 0, hits: 0, misses: 0 });
        expect(await cache.getCachedUri('Hallo')).toBeNull();
    });
});

describe('account switch', () => {
    it('never plays the audio of another account, and keeps each account its own cache', async () => {
        const cache = loadCache();
        const uriA = await cache.downloadAndCache('Hallo', 'u');

        mockCtl.user = 'u2';
        expect(await cache.getCachedUri('Hallo')).toBeNull();

        mockCtl.user = 'u1';
        expect(await cache.getCachedUri('Hallo')).toBe(uriA);
    });
});

describe('web', () => {
    it('has no cache and no download', async () => {
        jest.resetModules();
        jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
        const cache = require('../ttsCache') as Cache;

        expect(await cache.getCachedUri('Hallo')).toBeNull();
        await expect(cache.downloadAndCache('Hallo', 'u')).rejects.toThrow('unavailable on web');
        expect(await cache.getCacheStats()).toMatchObject({ entries: 0 });
        expect(mockCtl.downloads).toEqual([]);
    });
});
