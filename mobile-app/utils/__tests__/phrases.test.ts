import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { File, Paths } from 'expo-file-system';
import { loadPhraseStore, PhraseStore, syncPhraseStore } from '../phrases';
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
