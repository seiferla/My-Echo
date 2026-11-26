import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { CloudStatusProvider, useCloudStatus } from '../CloudStatusContext';
import { BACKEND_HEALTH_URL } from '../../utils/config';

// ---- Fakes ----

interface HealthBody {
    status?: unknown;
    voice?: unknown;
    model?: unknown;
    message?: unknown;
}

/** A fake fetch answer with an HTTP status and a JSON body. */
function healthResponse(body: HealthBody, httpStatus = 200) {
    return { status: httpStatus, json: async () => body } as unknown as Response;
}

/** A fake fetch answer whose body is not valid JSON. */
function brokenJsonResponse() {
    return {
        status: 200,
        json: async () => {
            throw new SyntaxError('Unexpected token < in JSON');
        },
    } as unknown as Response;
}

const OK = { status: 'ok', voice: 'v1', model: 'm1' };

// ---- Helpers ----

let fetchSpy: jest.SpiedFunction<typeof fetch>;
let warnSpy: ReturnType<typeof jest.spyOn>;
let logSpy: ReturnType<typeof jest.spyOn>;

function wrapper({ children }: { children: React.ReactNode }) {
    return <CloudStatusProvider>{children}</CloudStatusProvider>;
}

/** Renders the hook inside the provider. The first check runs at mount. */
async function renderStatus() {
    return renderHook(() => useCloudStatus(), { wrapper });
}

/** Moves the clock forward so the next poll runs. */
async function advance(ms: number) {
    await act(async () => {
        await jest.advanceTimersByTimeAsync(ms);
    });
}

// ---- Tests ----

describe('CloudStatusContext', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        fetchSpy = jest.spyOn(globalThis, 'fetch');
        warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
        logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        jest.restoreAllMocks();
        jest.useRealTimers();
    });

    describe('without a provider', () => {
        it('returns the safe default values', async () => {
            const { result } = await renderHook(() => useCloudStatus());

            expect(result.current).toEqual({ isAvailable: false, voice: '', model: '' });
            expect(fetchSpy).not.toHaveBeenCalled();
        });
    });

    describe('first check', () => {
        it('is not available before the first answer', async () => {
            fetchSpy.mockReturnValue(new Promise(() => {})); // never answers

            const { result } = await renderStatus();

            expect(result.current).toEqual({ isAvailable: false, voice: '', model: '' });
        });

        it('calls the health URL once at start with an abort signal', async () => {
            fetchSpy.mockResolvedValue(healthResponse(OK));

            await renderStatus();

            expect(fetchSpy).toHaveBeenCalledTimes(1);
            const [url, options] = fetchSpy.mock.calls[0];
            expect(url).toBe(BACKEND_HEALTH_URL);
            expect(options?.signal).toBeInstanceOf(AbortSignal);
        });
    });

    describe('status ok', () => {
        it('is available and exposes voice and model', async () => {
            fetchSpy.mockResolvedValue(healthResponse(OK));

            const { result } = await renderStatus();

            expect(result.current).toEqual({ isAvailable: true, voice: 'v1', model: 'm1' });
        });
    });

    describe('status not ok', () => {
        it('is not available but still updates voice and model', async () => {
            fetchSpy.mockResolvedValue(
                healthResponse({ status: 'degraded', voice: 'v2', model: 'm2' }, 503),
            );

            const { result } = await renderStatus();

            expect(result.current).toEqual({ isAvailable: false, voice: 'v2', model: 'm2' });
        });

        it('treats a missing status as not available', async () => {
            fetchSpy.mockResolvedValue(healthResponse({ voice: 'v1' }));

            const { result } = await renderStatus();

            expect(result.current.isAvailable).toBe(false);
            expect(result.current.voice).toBe('v1');
        });
    });

    describe('voice and model in the answer', () => {
        it('keeps the last known values when they are not strings', async () => {
            fetchSpy
                .mockResolvedValueOnce(healthResponse(OK))
                .mockResolvedValueOnce(healthResponse({ status: 'ok', voice: 42, model: null }));
            const { result } = await renderStatus();

            await advance(30_000);

            expect(result.current).toEqual({ isAvailable: true, voice: 'v1', model: 'm1' });
        });

        it('keeps the last known values when they are missing', async () => {
            fetchSpy
                .mockResolvedValueOnce(healthResponse(OK))
                .mockResolvedValueOnce(healthResponse({ status: 'ok' }));
            const { result } = await renderStatus();

            await advance(30_000);

            expect(result.current).toEqual({ isAvailable: true, voice: 'v1', model: 'm1' });
        });

        it('takes new values when the backend changes the voice', async () => {
            fetchSpy
                .mockResolvedValueOnce(healthResponse(OK))
                .mockResolvedValueOnce(healthResponse({ status: 'ok', voice: 'v9', model: 'm9' }));
            const { result } = await renderStatus();

            await advance(30_000);

            expect(result.current).toEqual({ isAvailable: true, voice: 'v9', model: 'm9' });
        });
    });

    describe('failed requests', () => {
        it('is not available when fetch rejects (network error)', async () => {
            fetchSpy.mockRejectedValue(new TypeError('Network request failed'));

            const { result } = await renderStatus();

            expect(result.current.isAvailable).toBe(false);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Network request failed'));
        });

        it('keeps the last voice and model when a later check fails', async () => {
            const timeout = new Error('The operation was aborted due to timeout');
            timeout.name = 'TimeoutError';
            fetchSpy.mockResolvedValueOnce(healthResponse(OK)).mockRejectedValueOnce(timeout);
            const { result } = await renderStatus();
            expect(result.current.isAvailable).toBe(true);

            await advance(30_000);

            expect(result.current).toEqual({ isAvailable: false, voice: 'v1', model: 'm1' });
        });

        it('is not available when the answer is not valid JSON', async () => {
            fetchSpy.mockResolvedValue(brokenJsonResponse());

            const { result } = await renderStatus();

            expect(result.current).toEqual({ isAvailable: false, voice: '', model: '' });
            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Health check failed'));
        });
    });

    describe('message in the answer', () => {
        it('logs the message as a warning', async () => {
            fetchSpy.mockResolvedValue(
                healthResponse({ status: 'degraded', message: 'TTS key missing' }, 503),
            );

            await renderStatus();

            expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('TTS key missing'));
        });

        it('does not warn when there is no message', async () => {
            fetchSpy.mockResolvedValue(healthResponse(OK));

            await renderStatus();

            expect(warnSpy).not.toHaveBeenCalled();
            expect(logSpy).toHaveBeenCalled();
        });
    });

    describe('polling', () => {
        it('checks again every 30 seconds', async () => {
            fetchSpy.mockResolvedValue(healthResponse(OK));
            await renderStatus();
            expect(fetchSpy).toHaveBeenCalledTimes(1);

            await advance(29_999);
            expect(fetchSpy).toHaveBeenCalledTimes(1);

            await advance(1);
            expect(fetchSpy).toHaveBeenCalledTimes(2);

            await advance(30_000);
            expect(fetchSpy).toHaveBeenCalledTimes(3);
        });

        it('recovers from not available to available', async () => {
            fetchSpy
                .mockRejectedValueOnce(new TypeError('Network request failed'))
                .mockResolvedValueOnce(healthResponse(OK));
            const { result } = await renderStatus();
            expect(result.current.isAvailable).toBe(false);

            await advance(30_000);

            expect(result.current).toEqual({ isAvailable: true, voice: 'v1', model: 'm1' });
        });

        it('switches from available to not available', async () => {
            fetchSpy
                .mockResolvedValueOnce(healthResponse(OK))
                .mockResolvedValueOnce(healthResponse({ status: 'degraded' }, 503));
            const { result } = await renderStatus();
            expect(result.current.isAvailable).toBe(true);

            await advance(30_000);

            expect(result.current.isAvailable).toBe(false);
        });
    });

    describe('unmount', () => {
        it('stops the polling', async () => {
            fetchSpy.mockResolvedValue(healthResponse(OK));
            const { unmount } = await renderStatus();
            expect(fetchSpy).toHaveBeenCalledTimes(1);

            await unmount();
            await advance(120_000);

            expect(fetchSpy).toHaveBeenCalledTimes(1);
        });
    });
});
