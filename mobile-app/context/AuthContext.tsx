import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { AuthError, Session } from '@supabase/supabase-js';
import { supabase } from '../utils/supabase';
import { deleteAccount as deleteAccountRequest } from '../utils/account';
import { adoptLegacyData, setLocalUser } from '../utils/localUser';
import { stopSpeaking } from '../utils/tts';

const TAG = '[myEcho][Auth]';

interface AuthContextType {
    session: Session | null;
    isLoading: boolean;
    /** Returns an error message for the user, or null on success. */
    signIn: (email: string, password: string) => Promise<string | null>;
    signOut: () => Promise<void>;
    /** Deletes the account (voice at Mistral + Supabase user). Returns an error message or null. */
    deleteAccount: () => Promise<string | null>;
}

const AuthContext = createContext<AuthContextType>({
    session: null,
    isLoading: true,
    signIn: async () => 'Anmeldung nicht verfügbar.',
    signOut: async () => {},
    deleteAccount: async () => 'Konto-Löschung nicht verfügbar.',
});

function toMessage(error: AuthError): string {
    if (isAuthRetryableFetchError(error)) {
        return 'Keine Verbindung. Bitte Internet prüfen und erneut versuchen.';
    }
    switch (error.code) {
        case 'invalid_credentials':
            return 'E-Mail oder Passwort ist falsch.';
        case 'over_request_rate_limit':
            return 'Zu viele Versuche. Bitte kurz warten.';
        default:
            return 'Anmeldung fehlgeschlagen. Bitte erneut versuchen.';
    }
}

/** Holds the Supabase session. Login goes straight to Supabase; the backend only sees the access token. */
export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const queue = useRef<Promise<void>>(Promise.resolve());

    // Set the local data owner BEFORE the session: the app screens mount only after
    // that, so they read the data of this account only. Queued because Supabase
    // can send several events right after each other.
    const applySession = (next: Session | null): Promise<void> => {
        queue.current = queue.current.then(async () => {
            try {
                setLocalUser(next?.user.id ?? null);
                if (next) await adoptLegacyData(next.user.id);
                setSession(next);
            } catch (e) {
                // Better signed out than showing data of another account.
                console.error(`${TAG} Could not prepare local data, staying signed out:`, e);
                setLocalUser(null);
                setSession(null);
            }
        });
        return queue.current;
    };

    useEffect(() => {
        if (!supabase) {
            console.warn(`${TAG} Supabase not configured (EXPO_PUBLIC_SUPABASE_URL/KEY missing)`);
            setIsLoading(false);
            return;
        }

        supabase.auth
            .getSession()
            .then(({ data }) => applySession(data.session))
            .catch((e) => console.warn(`${TAG} getSession failed: ${e?.message ?? e}`))
            .finally(() => setIsLoading(false));

        const { data } = supabase.auth.onAuthStateChange((_event, next) => {
            applySession(next);
        });
        return () => data.subscription.unsubscribe();
    }, []);

    const signIn = async (email: string, password: string): Promise<string | null> => {
        if (!supabase) {
            return 'Login ist nicht eingerichtet (Supabase-Konfiguration fehlt).';
        }
        const { error } = await supabase.auth.signInWithPassword({
            email: email.trim(),
            password,
        });
        if (error) {
            // Never log the email or password.
            console.warn(`${TAG} Sign-in failed: code=${error.code ?? '?'} status=${error.status ?? '?'}`);
            return toMessage(error);
        }
        return null;
    };

    const signOut = async () => {
        if (!supabase) return;
        // Local data stays on purpose: every account has its own files (see localUser.ts).
        stopSpeaking();
        const { error } = await supabase.auth.signOut();
        if (error) console.warn(`${TAG} Sign-out failed: ${error.message}`);
    };

    const deleteAccount = async (): Promise<string | null> => {
        if (!supabase) return 'Konto-Löschung ist nicht eingerichtet (Supabase-Konfiguration fehlt).';
        try {
            await deleteAccountRequest();
        } catch (e) {
            console.warn(`${TAG} Account deletion failed: ${(e as Error)?.message ?? e}`);
            return 'Konto konnte nicht gelöscht werden. Bitte erneut versuchen.';
        }
        stopSpeaking();
        // The user is gone on the server: sign out locally only (no logout call).
        const { error } = await supabase.auth.signOut({ scope: 'local' });
        if (error) console.warn(`${TAG} Local sign-out failed: ${error.message}`);
        setLocalUser(null);
        setSession(null);
        return null;
    };

    return (
        <AuthContext.Provider value={{ session, isLoading, signIn, signOut, deleteAccount }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
