import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { getTtsStats, syncTtsStats, TtsStats } from '../ttsLog';
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
