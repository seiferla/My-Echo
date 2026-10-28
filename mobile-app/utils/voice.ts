import { authHeaders } from './supabase';
import { BACKEND_VOICE_URL } from './config';

/** The user's cloned voice as stored in the backend. */
export interface Voice {
    voiceId: string;
    name: string;
    createdAt: number;
    consentedAt: number;
}

/** The user's cloned voice, or null when they have not uploaded one yet. */
export async function fetchVoice(): Promise<Voice | null> {
    const response = await fetch(BACKEND_VOICE_URL, { headers: await authHeaders() });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

/** Uploads an audio sample and clones the voice. Returns the stored voice. */
export async function uploadVoice(opts: {
    uri: string;
    fileName: string;
    mimeType: string;
    name: string;
    consent: boolean;
}): Promise<Voice> {
    const form = new FormData();
    form.append('name', opts.name);
    form.append('consent', opts.consent ? 'true' : 'false');
    // React Native FormData: a file entry is { uri, name, type }.
    form.append('file', { uri: opts.uri, name: opts.fileName, type: opts.mimeType } as unknown as Blob);

    const response = await fetch(BACKEND_VOICE_URL, {
        method: 'POST',
        headers: await authHeaders(),
        body: form,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
}

/** Deletes the user's cloned voice. */
export async function deleteVoice(): Promise<void> {
    const response = await fetch(BACKEND_VOICE_URL, {
        method: 'DELETE',
        headers: await authHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
