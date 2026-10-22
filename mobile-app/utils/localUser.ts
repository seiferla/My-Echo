import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { storage } from './storage';

const TAG = '[myEcho][LocalUser]';
const isWeb = Platform.OS === 'web';

// Local data has one file/key per account, e.g. "chats.<user_id>.json", so a second
// account on the same device never sees the first one's data and logout deletes nothing.
// AuthContext sets the id BEFORE the app screens read data.
let currentUserId: string | null = null;

export function setLocalUser(userId: string | null): void {
    currentUserId = userId;
}

/** "chats" → "chats.<user_id>", or "chats.signed-out" without a session. */
export function scoped(name: string): string {
    return `${name}.${currentUserId ?? 'signed-out'}`;
}

// Names from before accounts existed (one device, one person).
const LEGACY_FILES = ['chats', 'phrases'];
const LEGACY_KEYS = ['myEchoChatsFile', 'myEchoPhrases', 'myEchoTtsStats'];

/**
 * Gives the data of an old single-user install to the FIRST account that signs in.
 * After that the old files are gone, so no other account can get them.
 */
export async function adoptLegacyData(userId: string): Promise<void> {
    if (!isWeb) {
        // The old shared audio cache belongs to no account. It is only a cache: delete it.
        const legacyCache = new Directory(Paths.document, 'tts-cache');
        if (legacyCache.exists) {
            console.log(`${TAG} Removing shared legacy audio cache`);
            legacyCache.delete();
        }
        for (const name of LEGACY_FILES) {
            const legacy = new File(Paths.document, `${name}.json`);
            const target = new File(Paths.document, `${name}.${userId}.json`);
            if (legacy.exists && !target.exists) {
                console.log(`${TAG} Adopting legacy ${name}.json`);
                target.write(legacy.textSync());
                legacy.delete();
            }
        }
    }
    for (const key of LEGACY_KEYS) {
        const legacy = await storage.getItem(key);
        if (legacy !== null && (await storage.getItem(`${key}.${userId}`)) === null) {
            console.log(`${TAG} Adopting legacy key ${key}`);
            await storage.setItem(`${key}.${userId}`, legacy);
            await storage.removeItem(key);
        }
    }
}
