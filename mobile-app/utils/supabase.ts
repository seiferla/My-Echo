import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config';
import { authStorage } from './authStorage';

// Ohne URL/Key (z. B. Build ohne .env) kein Client — createClient würde sonst
// schon beim App-Start werfen. Der Login-Screen zeigt dann einen Hinweis.
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const supabase = isSupabaseConfigured
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: {
              storage: authStorage,
              autoRefreshToken: true,
              persistSession: true,
              detectSessionInUrl: false, // kein Browser-Redirect in einer nativen App
          },
      })
    : null;

/**
 * Authorization-Header für Backend-Aufrufe. getSession() erneuert einen
 * abgelaufenen Token automatisch. Ohne Session liefert es {}: das Backend
 * antwortet dann mit 401.
 */
export async function authHeaders(): Promise<Record<string, string>> {
    if (!supabase) return {};
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// Token nur im Vordergrund automatisch erneuern (Empfehlung für React Native).
// Laufende Wiedergabe ist nicht betroffen: der Token wird nur beim Request geprüft.
if (supabase) {
    AppState.addEventListener('change', (state) => {
        if (state === 'active') supabase.auth.startAutoRefresh();
        else supabase.auth.stopAutoRefresh();
    });
}
