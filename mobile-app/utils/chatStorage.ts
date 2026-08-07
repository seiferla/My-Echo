import { File, Paths } from 'expo-file-system';
import { storage } from './storage';

const TAG = '[myEcho][ChatStorage]';

// Der Chat-Verlauf wächst mit jeder Nachricht unbegrenzt weiter und gehört
// damit nicht in SecureStore — Keychain/Keystore sind für kleine Secrets
// gedacht, nicht für wachsende App-Daten (Android Keystore hat bekannte
// Größenlimits pro Wert). Stattdessen eine einfache JSON-Datei im
// App-eigenen Document-Verzeichnis, ohne Größenbeschränkung.
const chatsFile = new File(Paths.document, 'chats.json');

// Bisheriger SecureStore-Key — nur noch für die einmalige Migration gebraucht.
const LEGACY_KEY = 'myEchoChats';

export async function readChats(): Promise<string | null> {
    if (chatsFile.exists) {
        try {
            return chatsFile.textSync();
        } catch (e) {
            console.error(`${TAG} read failed:`, e);
            return null;
        }
    }

    // Datei existiert noch nicht → entweder frische Installation, oder der
    // Verlauf liegt noch im alten SecureStore-Eintrag (vor diesem Wechsel).
    // Einmalig übernehmen, damit kein bestehender Chat verloren geht.
    const legacy = await storage.getItem(LEGACY_KEY);
    if (legacy) {
        console.log(`${TAG} Migrating chat history out of SecureStore`);
        await writeChats(legacy);
        await storage.removeItem(LEGACY_KEY);
    }
    return legacy;
}

export async function writeChats(json: string): Promise<void> {
    try {
        chatsFile.write(json);
    } catch (e) {
        console.error(`${TAG} write failed:`, e);
        throw e;
    }
}
