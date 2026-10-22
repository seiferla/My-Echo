import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { isAuthRetryableFetchError } from '@supabase/supabase-js';
import type { AuthError, Session } from '@supabase/supabase-js';
import { supabase } from '../utils/supabase';
import { adoptLegacyData, setLocalUser } from '../utils/localUser';
import { stopSpeaking } from '../utils/tts';

const TAG = '[myEcho][Auth]';

interface AuthContextType {
    session: Session | null;
    isLoading: boolean;
    /** Liefert eine Fehlermeldung für den Nutzer, oder null bei Erfolg. */
    signIn: (email: string, password: string) => Promise<string | null>;
    signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
    session: null,
    isLoading: true,
    signIn: async () => 'Anmeldung nicht verfügbar.',
    signOut: async () => {},
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

/**
 * Hält die Supabase-Session und stellt signIn/signOut bereit. Der Login läuft
 * direkt App → Supabase; das Backend sieht später nur den Access-Token.
 * In _layout.tsx einbinden.
 */
export function AuthProvider({ children }: { children: React.ReactNode }) {
    const [session, setSession] = useState<Session | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const queue = useRef<Promise<void>>(Promise.resolve());

    // Setzt das aktive Konto für die lokalen Daten (Chats, Phrasen, Statistik),
    // BEVOR die Session gesetzt wird. Erst danach mounten die App-Screens und
    // lesen Daten — immer nur die des angemeldeten Kontos. Die Aufrufe laufen
    // nacheinander, weil Supabase mehrere Events kurz hintereinander sendet.
    const applySession = (next: Session | null): Promise<void> => {
        queue.current = queue.current.then(async () => {
            try {
                setLocalUser(next?.user.id ?? null);
                if (next) await adoptLegacyData(next.user.id);
                setSession(next);
            } catch (e) {
                // Lieber abgemeldet bleiben als Daten eines anderen Kontos zu zeigen.
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
            // Weder E-Mail noch Passwort loggen.
            console.warn(`${TAG} Sign-in failed: code=${error.code ?? '?'} status=${error.status ?? '?'}`);
            return toMessage(error);
        }
        return null;
    };

    const signOut = async () => {
        if (!supabase) return;
        // Laufende Sprachausgabe beenden. Lokale Daten bleiben bewusst erhalten:
        // sie liegen pro Konto in eigenen Dateien (siehe utils/localUser.ts).
        stopSpeaking();
        const { error } = await supabase.auth.signOut();
        if (error) console.warn(`${TAG} Sign-out failed: ${error.message}`);
    };

    return (
        <AuthContext.Provider value={{ session, isLoading, signIn, signOut }}>
            {children}
        </AuthContext.Provider>
    );
}

export function useAuth() {
    return useContext(AuthContext);
}
