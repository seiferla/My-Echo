import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { loadChatsForStart, mergeChats } from '../chatSync';
import { readChats } from '../chatStorage';
import { backendFetch } from '../backend';
import { Chat } from '../types';

jest.mock('../chatStorage', () => ({
    readChats: jest.fn(),
    writeChats: jest.fn(),
}));
jest.mock('../backend', () => ({ backendFetch: jest.fn() }));

const mockReadChats = jest.mocked(readChats);
const mockBackendFetch = jest.mocked(backendFetch);

function chat(id: string, timestamp: number, messageCount: number): Chat {
    return {
        id,
        title: id,
        timestamp,
        messages: Array.from({ length: messageCount }, (_, i) => ({
            id: `${id}-m${i}`,
            role: 'user' as const,
            content: `Nachricht ${i}`,
        })),
    };
}

const ids = (chats: Chat[]) => chats.map((c) => c.id);

function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

const jsonResponse = (body: unknown) => ({ json: async () => body }) as unknown as Response;

// GET returns `remote` (a value or a promise), PUT (pushChat) always works.
function mockBackend(remote: Chat[] | Promise<Chat[]>) {
    mockBackendFetch.mockImplementation(async (_url: string, opts?: { method?: string }) => {
        if (opts?.method === 'PUT') return jsonResponse(null);
        return jsonResponse(await remote);
    });
}

beforeEach(() => {
    jest.resetAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
});

describe('mergeChats', () => {
    it('never loses a local chat', () => {
        const merged = mergeChats([chat('local', 100, 1)], [chat('remote', 200, 1)]);
        expect(ids(merged)).toEqual(['remote', 'local']);
    });

    it('keeps local chats when the backend has none', () => {
        const local = [chat('a', 200, 2), chat('b', 100, 1)];
        expect(mergeChats(local, [])).toEqual(local);
    });

    it('takes the chat with more messages for the same id', () => {
        const richLocal = chat('a', 100, 3);
        const poorRemote = chat('a', 200, 1);
        expect(mergeChats([richLocal], [poorRemote])).toEqual([richLocal]);

        const poorLocal = chat('a', 200, 1);
        const richRemote = chat('a', 100, 3);
        expect(mergeChats([poorLocal], [richRemote])).toEqual([richRemote]);
    });

    it('takes the newer chat when the message count is the same', () => {
        const older = chat('a', 100, 2);
        const newer = chat('a', 200, 2);
        expect(mergeChats([older], [newer])).toEqual([newer]);
        expect(mergeChats([newer], [older])).toEqual([newer]);
    });

    it('sorts the result newest first', () => {
        const merged = mergeChats(
            [chat('mid', 200, 1), chat('old', 100, 1)],
            [chat('new', 300, 1)]
        );
        expect(ids(merged)).toEqual(['new', 'mid', 'old']);
    });
});

describe('loadChatsForStart', () => {
    it('returns merged chats when the backend is fast', async () => {
        mockReadChats.mockResolvedValue(JSON.stringify([chat('local', 100, 1)]));
        mockBackend([chat('remote', 200, 1)]);

        const result = await loadChatsForStart();

        expect(ids(result.chats)).toEqual(['remote', 'local']);
        expect(result.later).toBeNull();
    });

    it('returns local chats now and the sync later when the backend is slow', async () => {
        jest.useFakeTimers();
        mockReadChats.mockResolvedValue(JSON.stringify([chat('local', 100, 1)]));
        const remote = deferred<Chat[]>();
        mockBackend(remote.promise);

        const start = loadChatsForStart();
        await jest.advanceTimersByTimeAsync(600);
        const result = await start;

        expect(ids(result.chats)).toEqual(['local']);
        expect(result.later).not.toBeNull();

        remote.resolve([chat('remote', 200, 1)]);
        const later = await result.later;
        expect(ids(later!)).toEqual(['remote', 'local']);
    });

    it('waits for the backend when there are no local chats', async () => {
        jest.useFakeTimers();
        mockReadChats.mockResolvedValue(null);
        const remote = deferred<Chat[]>();
        mockBackend(remote.promise);

        let done = false;
        const start = loadChatsForStart().then((r) => {
            done = true;
            return r;
        });
        await jest.advanceTimersByTimeAsync(5_000);
        expect(done).toBe(false);

        remote.resolve([chat('remote', 200, 1)]);
        const result = await start;

        expect(ids(result.chats)).toEqual(['remote']);
        expect(result.later).toBeNull();
    });
});
