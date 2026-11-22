import { File, UploadType } from 'expo-file-system';
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

/**
 * Uploads an audio sample and clones the voice. Returns the stored voice.
 *
 * Uses the native multipart upload of expo-file-system instead of fetch + FormData:
 * the file is streamed from disk, so a { uri } FormData entry cannot fail silently.
 */
export async function uploadVoice(opts: {
    uri: string;
    mimeType: string;
    name: string;
    consent: boolean;
}): Promise<Voice> {
    const file = new File(opts.uri);
    if (!file.exists) throw new Error('Datei nicht lesbar');

    const result = await file.upload(BACKEND_VOICE_URL, {
        uploadType: UploadType.MULTIPART,
        fieldName: 'file',
        mimeType: opts.mimeType,
        parameters: { name: opts.name, consent: opts.consent ? 'true' : 'false' },
        headers: await authHeaders(),
    });
    if (result.status < 200 || result.status >= 300) {
        // Include the server's reason (e.g. "voice sample too large") for the error dialog.
        throw new Error(`HTTP ${result.status} ${result.body}`.trim().slice(0, 300));
    }
    return JSON.parse(result.body);
}

/** Deletes the user's cloned voice. */
export async function deleteVoice(): Promise<void> {
    const response = await fetch(BACKEND_VOICE_URL, {
        method: 'DELETE',
        headers: await authHeaders(),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
}
