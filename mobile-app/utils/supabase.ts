import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import { SUPABASE_URL, SUPABASE_KEY } from './config';
import { authStorage } from './authStorage';

// No client without URL/key (e.g. a build without .env): createClient would throw at app start.
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_KEY);

export const supabase = isSupabaseConfigured
    ? createClient(SUPABASE_URL, SUPABASE_KEY, {
          auth: {
              storage: authStorage,
              autoRefreshToken: true,
              persistSession: true,
              detectSessionInUrl: false, // no browser redirect in a native app
          },
      })
    : null;

/** Auth header for backend calls; getSession() refreshes an expired token. Empty when signed out. */
export async function authHeaders(): Promise<Record<string, string>> {
    if (!supabase) return {};
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
}

// Refresh tokens only in the foreground, as Supabase recommends for React Native.
if (supabase) {
    AppState.addEventListener('change', (state) => {
        if (state === 'active') supabase.auth.startAutoRefresh();
        else supabase.auth.stopAutoRefresh();
    });
}
