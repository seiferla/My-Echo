import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { storage } from './storage';
import { scoped } from './localUser';

const TAG = '[myEcho][ChatStorage]';

// The chat history grows with every message, so it does not belong in
// SecureStore (Keychain/Keystore are for small secrets and have size limits
// per value). It is a plain JSON file in the app's document folder instead.
// Web has no expo-file-system, so there the storage helper (localStorage) is
// used. The File object is created on demand, else the import crashes on web.
const isWeb = Platform.OS === 'web';
const WEB_KEY_BASE = 'myEchoChatsFile';

// One file per account (see localUser.ts). Not cached: the name changes when the account changes.
function chatsFileRef(): File {
    return new File(Paths.document, `${scoped('chats')}.json`);
}

// Old SecureStore key, only needed for the one-time migration.
const LEGACY_KEY = 'myEchoChats';

export async function readChats(): Promise<string | null> {
    if (isWeb) return storage.getItem(scoped(WEB_KEY_BASE));

    if (chatsFileRef().exists) {
        try {
            return chatsFileRef().textSync();
        } catch (e) {
            console.error(`${TAG} read failed:`, e);
            return null;
        }
    }

    // No file yet: a new install, or the history is still in the old SecureStore
    // entry. Move it over once, so no chat is lost.
    const legacy = await storage.getItem(LEGACY_KEY);
    if (legacy) {
        console.log(`${TAG} Migrating chat history out of SecureStore`);
        await writeChats(legacy);
        await storage.removeItem(LEGACY_KEY);
    }
    return legacy;
}

export async function writeChats(json: string): Promise<void> {
    if (isWeb) return storage.setItem(scoped(WEB_KEY_BASE), json);

    try {
        chatsFileRef().write(json);
    } catch (e) {
        console.error(`${TAG} write failed:`, e);
        throw e;
    }
}
