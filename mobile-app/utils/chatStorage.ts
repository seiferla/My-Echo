import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { storage } from './storage';

const TAG = '[myEcho][ChatStorage]';

// Der Chat-Verlauf wächst mit jeder Nachricht unbegrenzt weiter und gehört
// damit nicht in SecureStore — Keychain/Keystore sind für kleine Secrets
// gedacht, nicht für wachsende App-Daten (Android Keystore hat bekannte
// Größenlimits pro Wert). Stattdessen eine einfache JSON-Datei im
// App-eigenen Document-Verzeichnis, ohne Größenbeschränkung.
// Im Web gibt es kein expo-file-system — dort übernimmt der storage-Helper
// (localStorage). Die File-Instanz erst bei Bedarf erzeugen, sonst crasht
// bereits der Modul-Import im Browser.
const isWeb = Platform.OS === 'web';
const WEB_KEY = 'myEchoChatsFile';

let _chatsFile: File | null = null;
function chatsFileRef(): File {
    if (!_chatsFile) _chatsFile = new File(Paths.document, 'chats.json');
    return _chatsFile;
}

// Bisheriger SecureStore-Key — nur noch für die einmalige Migration gebraucht.
const LEGACY_KEY = 'myEchoChats';

export async function readChats(): Promise<string | null> {
    if (isWeb) return storage.getItem(WEB_KEY);

    if (chatsFileRef().exists) {
        try {
            return chatsFileRef().textSync();
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
    if (isWeb) return storage.setItem(WEB_KEY, json);

    try {
        chatsFileRef().write(json);
    } catch (e) {
        console.error(`${TAG} write failed:`, e);
        throw e;
    }
}
