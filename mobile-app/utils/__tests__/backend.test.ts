import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { backendFetch } from '../backend';

jest.mock('../supabase', () => ({
    authHeaders: async () => ({ Authorization: 'Bearer test-token' }),
}));

const CHATS_URL = 'https://backend.test/chats';
const mockFetch = jest.fn<(url: string, init: RequestInit) => Promise<Response>>();
const realFetch = globalThis.fetch;

const response = (status: number) => ({ ok: status >= 200 && status < 300, status }) as Response;
const lastRequest = () => mockFetch.mock.calls[0][1];

beforeEach(() => {
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(response(200));
    globalThis.fetch = mockFetch as unknown as typeof fetch;
});

afterEach(() => {
    globalThis.fetch = realFetch;
});

describe('backendFetch', () => {
    it('sends the auth header without Content-Type when there is no body', async () => {
        await backendFetch(CHATS_URL);

        expect(mockFetch).toHaveBeenCalledWith(CHATS_URL, expect.anything());
        expect(lastRequest().method).toBe('GET');
        expect(lastRequest().headers).toEqual({ Authorization: 'Bearer test-token' });
        expect(lastRequest().body).toBeUndefined();
    });

    it('sends JSON with Content-Type and the auth header', async () => {
        await backendFetch(CHATS_URL, { method: 'PUT', json: { title: 'Hallo' } });

        expect(lastRequest().method).toBe('PUT');
        expect(lastRequest().headers).toEqual({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-token',
        });
        expect(lastRequest().body).toBe('{"title":"Hallo"}');
    });

    it('sends no Content-Type for a DELETE without body', async () => {
        await backendFetch(CHATS_URL, { method: 'DELETE' });

        expect(lastRequest().headers).toEqual({ Authorization: 'Bearer test-token' });
    });

    it('throws on a non-2xx status', async () => {
        mockFetch.mockResolvedValue(response(500));

        await expect(backendFetch(CHATS_URL)).rejects.toThrow('HTTP 500');
    });

    it('returns the response on success', async () => {
        const ok = response(204);
        mockFetch.mockResolvedValue(ok);

        await expect(backendFetch(CHATS_URL)).resolves.toBe(ok);
    });
});
