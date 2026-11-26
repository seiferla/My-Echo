import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { dayKey, getTtsStats, recordTtsRequest, syncTtsStats, TtsStats } from '../ttsLog';
import { storage } from '../storage';
import { scoped } from '../localUser';
import { backendFetch } from '../backend';
import { BACKEND_TTS_STATS_URL } from '../config';

// SecureStore as an in-memory map.
jest.mock('expo-secure-store', () => {
    const store = new Map<string, string>();
    return {
        getItemAsync: async (key: string) => store.get(key) ?? null,
        setItemAsync: async (key: string, value: string) => {
            store.set(key, value);
        },
        deleteItemAsync: async (key: string) => {
            store.delete(key);
        },
    };
});
jest.mock('../backend', () => ({ backendFetch: jest.fn() }));

const mockBackendFetch = jest.mocked(backendFetch);
const STATS_KEY = scoped('myEchoTtsStats');

const jsonResponse = (body: unknown) => ({ json: async () => body }) as unknown as Response;

// GET returns `remote`, POST (push) always works.
function mockBackend(remote: TtsStats) {
    mockBackendFetch.mockImplementation(async (_url: string, opts?: { method?: string }) =>
        jsonResponse(opts?.method === 'POST' ? null : remote)
    );
}

const pushes = () =>
    mockBackendFetch.mock.calls.filter(([, opts]) => opts?.method === 'POST');

beforeEach(async () => {
    jest.resetAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    await storage.removeItem(STATS_KEY);
});

afterEach(() => {
    jest.restoreAllMocks();
});

describe('syncTtsStats', () => {
    it('keeps the larger value per day and field', async () => {
        await storage.setItem(
            STATS_KEY,
            JSON.stringify({
                '2026-10-01': { requests: 5, chars: 10, durationMs: 900 },
                '2026-10-02': { requests: 1, chars: 4, durationMs: 100 },
            })
        );
        mockBackend({
            '2026-10-01': { requests: 3, chars: 50, durationMs: 200 },
            '2026-10-03': { requests: 2, chars: 8, durationMs: 300 },
        });

        await syncTtsStats();

        expect(await getTtsStats()).toEqual({
            '2026-10-01': { requests: 5, chars: 50, durationMs: 900 },
            '2026-10-02': { requests: 1, chars: 4, durationMs: 100 },
            '2026-10-03': { requests: 2, chars: 8, durationMs: 300 },
        });
    });

    it('pushes only the days the backend does not have yet', async () => {
        await storage.setItem(
            STATS_KEY,
            JSON.stringify({
                '2026-10-01': { requests: 5, chars: 10, durationMs: 900 },
                '2026-10-02': { requests: 1, chars: 4, durationMs: 100 },
            })
        );
        mockBackend({
            '2026-10-01': { requests: 3, chars: 50, durationMs: 200 },
            '2026-10-02': { requests: 1, chars: 4, durationMs: 100 },
        });

        await syncTtsStats();

        expect(pushes()).toEqual([
            [
                BACKEND_TTS_STATS_URL,
                {
                    method: 'POST',
                    json: { '2026-10-01': { requests: 5, chars: 50, durationMs: 900 } },
                },
            ],
        ]);
    });

    it('keeps local stats when the backend is offline', async () => {
        const local = { '2026-10-01': { requests: 5, chars: 10, durationMs: 900 } };
        await storage.setItem(STATS_KEY, JSON.stringify(local));
        mockBackendFetch.mockRejectedValue(new Error('offline'));

        await expect(syncTtsStats()).resolves.toBeUndefined();
        expect(await getTtsStats()).toEqual(local);
    });
});

describe('dayKey', () => {
    it('formats a local date as YYYY-MM-DD with zero padding', () => {
        expect(dayKey(new Date(2026, 0, 5, 13, 30).getTime())).toBe('2026-01-05');
        expect(dayKey(new Date(2026, 11, 31, 23, 59).getTime())).toBe('2026-12-31');
    });
});

describe('getTtsStats', () => {
    it('returns an empty object when nothing is stored', async () => {
        expect(await getTtsStats()).toEqual({});
    });

    it('returns an empty object when the stored value is not valid JSON', async () => {
        await storage.setItem(STATS_KEY, '{ broken');

        expect(await getTtsStats()).toEqual({});
    });
});

describe('recordTtsRequest', () => {
    const NOW = new Date(2026, 9, 5, 12, 0).getTime();
    const TODAY = '2026-10-05';

    beforeEach(() => {
        jest.spyOn(Date, 'now').mockReturnValue(NOW);
        mockBackend({});
    });

    it('creates today\'s bucket and pushes it to the backend', async () => {
        await recordTtsRequest(12, 3400);

        const bucket = { requests: 1, chars: 12, durationMs: 3400 };
        expect(await getTtsStats()).toEqual({ [TODAY]: bucket });
        expect(pushes()).toEqual([
            [BACKEND_TTS_STATS_URL, { method: 'POST', json: { [TODAY]: bucket } }],
        ]);
    });

    it('adds to today\'s bucket and keeps other days', async () => {
        await storage.setItem(
            STATS_KEY,
            JSON.stringify({
                '2026-10-01': { requests: 9, chars: 90, durationMs: 900 },
                [TODAY]: { requests: 1, chars: 10, durationMs: 100 },
            })
        );

        await recordTtsRequest(5, 50);

        expect(await getTtsStats()).toEqual({
            '2026-10-01': { requests: 9, chars: 90, durationMs: 900 },
            [TODAY]: { requests: 2, chars: 15, durationMs: 150 },
        });
    });

    it('counts the request but clamps negative chars and duration to 0', async () => {
        await recordTtsRequest(-5, -100);

        expect(await getTtsStats()).toEqual({ [TODAY]: { requests: 1, chars: 0, durationMs: 0 } });
    });

    it('keeps the local value when the backend push fails', async () => {
        mockBackendFetch.mockRejectedValue(new Error('offline'));

        await expect(recordTtsRequest(3, 30)).resolves.toBeUndefined();
        await new Promise<void>((resolve) => setImmediate(resolve));

        expect((await getTtsStats())[TODAY]).toEqual({ requests: 1, chars: 3, durationMs: 30 });
    });
});

describe('syncTtsStats remaining branches', () => {
    it('does not push or rewrite when local and backend are equal', async () => {
        const same = { '2026-10-01': { requests: 1, chars: 2, durationMs: 3 } };
        await storage.setItem(STATS_KEY, JSON.stringify(same));
        mockBackend(same);

        await syncTtsStats();

        expect(pushes()).toEqual([]);
        expect(await getTtsStats()).toEqual(same);
    });

    it('pushes local stats when the backend has nothing', async () => {
        const local = { '2026-10-01': { requests: 1, chars: 2, durationMs: 3 } };
        await storage.setItem(STATS_KEY, JSON.stringify(local));
        mockBackend({});

        await syncTtsStats();

        expect(pushes()).toEqual([[BACKEND_TTS_STATS_URL, { method: 'POST', json: local }]]);
    });

    it('stores backend days locally without pushing them back', async () => {
        const remote = { '2026-10-03': { requests: 2, chars: 8, durationMs: 300 } };
        mockBackend(remote);

        await syncTtsStats();

        expect(await getTtsStats()).toEqual(remote);
        expect(pushes()).toEqual([]);
    });
});
