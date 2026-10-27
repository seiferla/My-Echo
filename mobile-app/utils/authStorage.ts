import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TAG = '[myEcho][AuthStorage]';

// The Supabase session is bigger than the ~2 KB SecureStore allows per value,
// so it is stored in chunks: <key>.0, <key>.1, ... plus <key>.count.
const CHUNK_SIZE = 1500;

const countKey = (key: string) => `${key}.count`;
const chunkKey = (key: string, i: number) => `${key}.${i}`;

async function readCount(key: string): Promise<number> {
    const raw = await SecureStore.getItemAsync(countKey(key));
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : 0;
}

export const authStorage = {
    async getItem(key: string): Promise<string | null> {
        try {
            if (Platform.OS === 'web') return localStorage.getItem(key);

            const count = await readCount(key);
            if (count === 0) return null;

            const parts: string[] = [];
            for (let i = 0; i < count; i++) {
                const part = await SecureStore.getItemAsync(chunkKey(key, i));
                if (part === null) return null; // incomplete = signed out
                parts.push(part);
            }
            return parts.join('');
        } catch (e) {
            console.error(`${TAG} getItem failed:`, e);
            return null;
        }
    },

    async setItem(key: string, value: string): Promise<void> {
        if (Platform.OS === 'web') {
            localStorage.setItem(key, value);
            return;
        }

        const oldCount = await readCount(key);
        const chunks: string[] = [];
        for (let i = 0; i < value.length; i += CHUNK_SIZE) {
            chunks.push(value.slice(i, i + CHUNK_SIZE));
        }

        // Write chunks and count first, then delete old extra chunks,
        // so a crash in between never leaves a broken session.
        for (let i = 0; i < chunks.length; i++) {
            await SecureStore.setItemAsync(chunkKey(key, i), chunks[i]);
        }
        await SecureStore.setItemAsync(countKey(key), String(chunks.length));
        for (let i = chunks.length; i < oldCount; i++) {
            await SecureStore.deleteItemAsync(chunkKey(key, i));
        }
    },

    async removeItem(key: string): Promise<void> {
        try {
            if (Platform.OS === 'web') {
                localStorage.removeItem(key);
                return;
            }
            const count = await readCount(key);
            await SecureStore.deleteItemAsync(countKey(key));
            for (let i = 0; i < count; i++) {
                await SecureStore.deleteItemAsync(chunkKey(key, i));
            }
        } catch (e) {
            console.error(`${TAG} removeItem failed:`, e);
        }
    },
};
