import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { storage } from './storage';

const TAG = '[myEcho][LocalUser]';
const isWeb = Platform.OS === 'web';

// Lokale Daten (Chats, Phrasen, Statistik) liegen pro Konto in eigenen
// Dateien bzw. Keys: "chats.<user_id>.json", "myEchoTtsStats.<user_id>" usw.
// So sieht ein zweites Konto auf demselben Gerät nie die Daten des ersten,
// und ein Logout löscht nichts (Phrasen und Statistik gibt es nur lokal).
// AuthContext setzt die ID, BEVOR die App-Screens Daten lesen.
let currentUserId: string | null = null;

export function setLocalUser(userId: string | null): void {
    currentUserId = userId;
}

/** "chats" → "chats.<user_id>". Ohne Anmeldung "chats.signed-out" (wird nie angezeigt). */
export function scoped(name: string): string {
    return `${name}.${currentUserId ?? 'signed-out'}`;
}

// Namen der Daten aus der Zeit vor den Konten (ein Gerät, eine Person).
const LEGACY_FILES = ['chats', 'phrases'];        // <name>.json im Document-Ordner
const LEGACY_KEYS = ['myEchoChatsFile', 'myEchoPhrases', 'myEchoTtsStats']; // storage-Keys (Web + Statistik)

/**
 * Übernimmt Daten einer älteren Installation für das ERSTE Konto, das sich
 * anmeldet: Die alten Dateien gehörten der einen Person, die das Gerät bisher
 * allein genutzt hat. Danach sind sie weg, ein weiteres Konto bekommt sie nie.
 */
export async function adoptLegacyData(userId: string): Promise<void> {
    if (!isWeb) {
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
