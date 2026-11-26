import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { AuthApiError, AuthRetryableFetchError } from '@supabase/supabase-js';
import type { Session } from '@supabase/supabase-js';
import { AuthProvider, useAuth } from '../AuthContext';
import { scoped, setLocalUser } from '../../utils/localUser';

// ---- Fakes ----

type AuthStateCallback = (event: string, session: Session | null) => void;

const mockUnsubscribe = jest.fn();
let mockAuthStateCallback: AuthStateCallback | null = null;

const mockAuth = {
    getSession: jest.fn<() => Promise<any>>(),
    onAuthStateChange: jest.fn((cb: AuthStateCallback) => {
        mockAuthStateCallback = cb;
        return { data: { subscription: { unsubscribe: mockUnsubscribe } } };
    }),
    signInWithPassword: jest.fn<(creds: any) => Promise<any>>(),
    signOut: jest.fn<(opts?: any) => Promise<any>>(),
};

// A getter, so a test can switch "supabase" to null (= not configured).
let mockSupabaseEnabled = true;
jest.mock('../../utils/supabase', () => ({
    get supabase() {
        return mockSupabaseEnabled ? { auth: mockAuth } : null;
    },
}));

const mockDeleteAccountRequest = jest.fn<() => Promise<void>>();
jest.mock('../../utils/account', () => ({
    deleteAccount: () => mockDeleteAccountRequest(),
}));

const mockStopSpeaking = jest.fn();
jest.mock('../../utils/tts', () => ({
    stopSpeaking: () => mockStopSpeaking(),
}));

function fakeSession(userId: string): Session {
    return { user: { id: userId }, access_token: 'token' } as unknown as Session;
}

// ---- Helpers ----

let warnSpy: ReturnType<typeof jest.spyOn>;
let errorSpy: ReturnType<typeof jest.spyOn>;
let logSpy: ReturnType<typeof jest.spyOn>;

function wrapper({ children }: { children: React.ReactNode }) {
    return <AuthProvider>{children}</AuthProvider>;
}

/** Renders the hook and records the (session id, local user scope) of every render. */
async function renderAuth() {
    const renders: Array<{ sessionId: string | null; scope: string }> = [];
    const view = await renderHook(
        () => {
            const auth = useAuth();
            renders.push({ sessionId: auth.session?.user.id ?? null, scope: scoped('x') });
            return auth;
        },
        { wrapper },
    );
    return { ...view, renders };
}

/** Renders the hook and waits until the start is finished. */
async function renderReady() {
    const view = await renderAuth();
    await waitFor(() => expect(view.result.current.isLoading).toBe(false));
    return view;
}

function allConsoleText(): string {
    return [warnSpy, errorSpy, logSpy]
        .flatMap((spy) => spy.mock.calls)
        .map((args) => args.map(String).join(' '))
        .join('\n');
}

beforeEach(() => {
    jest.clearAllMocks();
    mockSupabaseEnabled = true;
    mockAuthStateCallback = null;
    setLocalUser(null);
    mockAuth.getSession.mockResolvedValue({ data: { session: null } });
    mockAuth.signInWithPassword.mockResolvedValue({ error: null });
    mockAuth.signOut.mockResolvedValue({ error: null });
    mockDeleteAccountRequest.mockResolvedValue(undefined);
    warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    jest.restoreAllMocks();
});

// ---- Tests ----

describe('without Supabase configuration', () => {
    beforeEach(() => {
        mockSupabaseEnabled = false;
    });

    it('stops loading and has no session', async () => {
        const { result } = await renderReady();

        expect(result.current.session).toBeNull();
        expect(mockAuth.getSession).not.toHaveBeenCalled();
    });

    it('signIn returns the "nicht eingerichtet" message', async () => {
        const { result } = await renderReady();

        const message = await result.current.signIn('a@b.de', 'pw');

        expect(message).toBe('Login ist nicht eingerichtet (Supabase-Konfiguration fehlt).');
        expect(mockAuth.signInWithPassword).not.toHaveBeenCalled();
    });

    it('deleteAccount returns the "nicht eingerichtet" message and sends no request', async () => {
        const { result } = await renderReady();

        const message = await result.current.deleteAccount();

        expect(message).toBe('Konto-Löschung ist nicht eingerichtet (Supabase-Konfiguration fehlt).');
        expect(mockDeleteAccountRequest).not.toHaveBeenCalled();
    });

    it('signOut does nothing', async () => {
        const { result } = await renderReady();

        await result.current.signOut();

        expect(mockStopSpeaking).not.toHaveBeenCalled();
        expect(mockAuth.signOut).not.toHaveBeenCalled();
    });
});

describe('useAuth without a provider', () => {
    it('returns the safe defaults', async () => {
        const { result } = await renderHook(() => useAuth());

        expect(result.current.session).toBeNull();
        expect(result.current.isLoading).toBe(true);
        expect(await result.current.signIn('a@b.de', 'pw')).toBe('Anmeldung nicht verfügbar.');
        expect(await result.current.deleteAccount()).toBe('Konto-Löschung nicht verfügbar.');
        await expect(result.current.signOut()).resolves.toBeUndefined();
    });
});

describe('start', () => {
    it('is loading until getSession is finished', async () => {
        let finish: (value: any) => void = () => {};
        mockAuth.getSession.mockReturnValue(new Promise((resolve) => (finish = resolve)));
        const { result } = await renderAuth();

        expect(result.current.isLoading).toBe(true);

        await act(async () => finish({ data: { session: null } }));

        expect(result.current.isLoading).toBe(false);
    });

    it('applies the stored session and the local user', async () => {
        mockAuth.getSession.mockResolvedValue({ data: { session: fakeSession('u1') } });

        const { result } = await renderReady();

        expect(result.current.session?.user.id).toBe('u1');
        expect(scoped('x')).toBe('x.u1');
    });

    it('has no session when nobody is signed in', async () => {
        const { result } = await renderReady();

        expect(result.current.session).toBeNull();
        expect(scoped('x')).toBe('x.signed-out');
    });

    it('stops loading and only warns when getSession rejects', async () => {
        mockAuth.getSession.mockRejectedValue(new Error('storage broken'));

        const { result } = await renderReady();

        expect(result.current.session).toBeNull();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('getSession failed: storage broken'));
    });
});

describe('onAuthStateChange', () => {
    it('has the local user set in every render that shows the session', async () => {
        const { result, renders } = await renderReady();

        await act(async () => mockAuthStateCallback!('SIGNED_IN', fakeSession('u2')));

        expect(result.current.session?.user.id).toBe('u2');
        const rendersWithSession = renders.filter((r) => r.sessionId === 'u2');
        expect(rendersWithSession.length).toBeGreaterThan(0);
        expect(rendersWithSession.every((r) => r.scope === 'x.u2')).toBe(true);
    });

    it('clears the session and the local user on sign-out', async () => {
        mockAuth.getSession.mockResolvedValue({ data: { session: fakeSession('u1') } });
        const { result } = await renderReady();

        await act(async () => mockAuthStateCallback!('SIGNED_OUT', null));

        expect(result.current.session).toBeNull();
        expect(scoped('x')).toBe('x.signed-out');
    });

    it('unsubscribes on unmount', async () => {
        const { unmount } = await renderReady();

        await unmount();

        expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
    });
});

describe('signIn', () => {
    it('trims the email, keeps the password and returns null on success', async () => {
        const { result } = await renderReady();

        const message = await result.current.signIn('  a@b.de \n', ' pw ');

        expect(message).toBeNull();
        expect(mockAuth.signInWithPassword).toHaveBeenCalledWith({ email: 'a@b.de', password: ' pw ' });
    });

    it.each([
        ['invalid_credentials', 400, 'E-Mail oder Passwort ist falsch.'],
        ['over_request_rate_limit', 429, 'Zu viele Versuche. Bitte kurz warten.'],
        ['something_else', 500, 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.'],
    ])('maps the error code "%s" to a German message', async (code, status, expected) => {
        mockAuth.signInWithPassword.mockResolvedValue({
            error: new AuthApiError('boom', status, code as any),
        });
        const { result } = await renderReady();

        const message = await result.current.signIn('a@b.de', 'pw');

        expect(message).toBe(expected);
    });

    it('returns the connection message for a retryable fetch error', async () => {
        mockAuth.signInWithPassword.mockResolvedValue({
            error: new AuthRetryableFetchError('offline', 0),
        });
        const { result } = await renderReady();

        const message = await result.current.signIn('a@b.de', 'pw');

        expect(message).toBe('Keine Verbindung. Bitte Internet prüfen und erneut versuchen.');
    });

    it('uses the default message when the error has no code', async () => {
        mockAuth.signInWithPassword.mockResolvedValue({ error: { message: 'x' } });
        const { result } = await renderReady();

        const message = await result.current.signIn('a@b.de', 'pw');

        expect(message).toBe('Anmeldung fehlgeschlagen. Bitte erneut versuchen.');
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('code=? status=?'));
    });

    it('never logs the email or the password', async () => {
        mockAuth.signInWithPassword.mockResolvedValue({
            error: new AuthApiError('Invalid login for secret@mail.de', 400, 'invalid_credentials'),
        });
        const { result } = await renderReady();

        await result.current.signIn('secret@mail.de', 'topsecret-pw');

        expect(warnSpy).toHaveBeenCalled();
        expect(allConsoleText()).not.toContain('secret@mail.de');
        expect(allConsoleText()).not.toContain('topsecret-pw');
    });
});

describe('signOut', () => {
    it('stops speaking and then signs out at Supabase', async () => {
        const order: string[] = [];
        mockStopSpeaking.mockImplementation(() => order.push('stopSpeaking'));
        mockAuth.signOut.mockImplementation(async () => {
            order.push('signOut');
            return { error: null };
        });
        const { result } = await renderReady();

        await result.current.signOut();

        expect(order).toEqual(['stopSpeaking', 'signOut']);
    });

    it('only logs a sign-out error', async () => {
        mockAuth.signOut.mockResolvedValue({ error: new Error('network down') });
        const { result } = await renderReady();

        await expect(result.current.signOut()).resolves.toBeUndefined();

        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Sign-out failed: network down'));
    });
});

describe('deleteAccount', () => {
    it('returns an error message and stays signed in when the backend fails', async () => {
        mockAuth.getSession.mockResolvedValue({ data: { session: fakeSession('u1') } });
        mockDeleteAccountRequest.mockRejectedValue(new Error('HTTP 500'));
        const { result } = await renderReady();

        let message: string | null = null;
        await act(async () => {
            message = await result.current.deleteAccount();
        });

        expect(message).toBe('Konto konnte nicht gelöscht werden. Bitte erneut versuchen.');
        expect(result.current.session?.user.id).toBe('u1');
        expect(scoped('x')).toBe('x.u1');
        expect(mockStopSpeaking).not.toHaveBeenCalled();
        expect(mockAuth.signOut).not.toHaveBeenCalled();
    });

    it('stops speaking, signs out locally and clears user and session on success', async () => {
        mockAuth.getSession.mockResolvedValue({ data: { session: fakeSession('u1') } });
        const { result } = await renderReady();

        let message: string | null = 'not set';
        await act(async () => {
            message = await result.current.deleteAccount();
        });

        expect(message).toBeNull();
        expect(mockStopSpeaking).toHaveBeenCalledTimes(1);
        expect(mockAuth.signOut).toHaveBeenCalledWith({ scope: 'local' });
        expect(scoped('x')).toBe('x.signed-out');
        expect(result.current.session).toBeNull();
    });

    it('still clears user and session when the local sign-out fails', async () => {
        mockAuth.getSession.mockResolvedValue({ data: { session: fakeSession('u1') } });
        mockAuth.signOut.mockResolvedValue({ error: new Error('storage error') });
        const { result } = await renderReady();

        let message: string | null = 'not set';
        await act(async () => {
            message = await result.current.deleteAccount();
        });

        expect(message).toBeNull();
        expect(result.current.session).toBeNull();
        expect(scoped('x')).toBe('x.signed-out');
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Local sign-out failed: storage error'));
    });
});
