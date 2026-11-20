import { authHeaders } from './supabase';
import { BACKEND_ACCOUNT_URL } from './config';

/** Deletes the user's account on the backend (voice at Mistral + Supabase auth user). */
export async function deleteAccount(): Promise<void> {
    const response = await fetch(BACKEND_ACCOUNT_URL, {
        method: 'DELETE',
        headers: await authHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
