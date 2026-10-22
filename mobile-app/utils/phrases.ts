import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { storage } from './storage';
import { getShareableAudioUri } from './tts';
import { scoped } from './localUser';
import { BACKEND_PHRASES_URL } from './config';
import { authHeaders } from './supabase';

const TAG = '[myEcho][Phrases]';

// Wie in chatStorage.ts: im Web kein Dateisystem, also localStorage über den
// storage-Helper. Die File-Instanz wird erst beim ersten Zugriff erzeugt.
const isWeb = Platform.OS === 'web';
const WEB_KEY_BASE = 'myEchoPhrases';

// Pro Konto eine eigene Datei (siehe localUser.ts). Nicht zwischenspeichern:
// beim Kontowechsel ändert sich der Name.
function phrasesFileRef(): File {
    return new File(Paths.document, `${scoped('phrases')}.json`);
}

async function readRaw(): Promise<string | null> {
    if (isWeb) return storage.getItem(scoped(WEB_KEY_BASE));
    return phrasesFileRef().exists ? phrasesFileRef().textSync() : null;
}

async function writeRaw(json: string): Promise<void> {
    if (isWeb) return storage.setItem(scoped(WEB_KEY_BASE), json);
    phrasesFileRef().write(json);
}

export interface Phrase {
    id: string;
    text: string;
    useCount: number;
    lastUsedAt?: number;
    createdAt: number;
}

export interface PhraseSettings {
    // Wie viele Phrasen in der ChatArea liegen (0 = ausgeblendet).
    visibleCount: number;
    // Gilt für alle Phrasen gemeinsam:
    //   an  → Antippen sendet und spricht sofort (schnellste Antwort)
    //   aus → Antippen legt den Text nur ins Eingabefeld (nichts wird gesprochen)
    instantEnabled: boolean;
}

export interface PhraseStore {
    phrases: Phrase[];
    settings: PhraseSettings;
    // Zeitpunkt der letzten Änderung (ms). 0 = unveränderte Startbelegung.
    // Beim Abgleich mit dem Backend gewinnt der neuere Stand.
    updatedAt?: number;
}

// Obergrenze für die ChatArea. Mehr Chips würden die Oberfläche unruhig machen
// und die Trefferfläche pro Chip verkleinern.
export const MAX_VISIBLE_PHRASES = 3;

export const DEFAULT_SETTINGS: PhraseSettings = {
    visibleCount: 3,
    instantEnabled: true,
};

export function newPhraseId(): string {
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Startbelegung bei der ersten Installation. Ohne sie wäre die Funktion beim
// ersten Öffnen leer und damit wertlos — gerade die schnellen Ein-Wort-
// Antworten ("Ja", "Nein") sind der Kern des Nutzens.
const DEFAULTS: string[] = [
    'Ja',
    'Nein',
    'Danke',
    'Hallo',
    'Einen Moment bitte, ich schreibe.',
    'Bitte etwas langsamer.',
    'Ich habe verstanden.',
    'Ich brauche Hilfe.',
    'Mir geht es gut.',
];

function seed(): Phrase[] {
    const now = Date.now();
    return DEFAULTS.map((text, i) => ({
        id: newPhraseId() + '-' + i,
        text,
        useCount: 0,
        createdAt: now,
    }));
}

// Nimmt nur die Felder, die es heute noch gibt — ältere Dateien hatten ein
// "instant" pro Phrase, das inzwischen der globale Schalter ersetzt.
function normalizePhrase(p: Phrase): Phrase {
    return {
        id: p.id || newPhraseId(),
        text: p.text,
        useCount: p.useCount ?? 0,
        lastUsedAt: p.lastUsedAt,
        createdAt: p.createdAt ?? Date.now(),
    };
}

function normalizeSettings(s: Partial<PhraseSettings> | undefined): PhraseSettings {
    const count = Number(s?.visibleCount);
    return {
        visibleCount: Number.isFinite(count)
            ? Math.max(0, Math.min(MAX_VISIBLE_PHRASES, Math.trunc(count)))
            : DEFAULT_SETTINGS.visibleCount,
        instantEnabled: s?.instantEnabled ?? DEFAULT_SETTINGS.instantEnabled,
    };
}

export async function loadPhraseStore(): Promise<PhraseStore> {
    let raw: string | null = null;
    try {
        raw = await readRaw();
    } catch (e) {
        console.error(`${TAG} read failed:`, e);
    }

    if (raw === null) {
        // updatedAt 0: die Startbelegung darf nie einen echten Stand aus dem Backend überschreiben.
        const initial: PhraseStore = { phrases: seed(), settings: { ...DEFAULT_SETTINGS }, updatedAt: 0 };
        await writeLocalStore(initial);
        console.log(`${TAG} Seeded ${initial.phrases.length} default phrases`);
        return initial;
    }

    try {
        const parsed = JSON.parse(raw);

        // Version 1 speicherte nur ein nacktes Array. Einmalig in die neue
        // Struktur mit Einstellungen überführen, ohne Phrasen zu verlieren.
        if (Array.isArray(parsed)) {
            const migrated: PhraseStore = {
                phrases: parsed.filter((p) => p?.text).map(normalizePhrase),
                settings: { ...DEFAULT_SETTINGS },
                updatedAt: Date.now(),
            };
            await writeLocalStore(migrated);
            console.log(`${TAG} Migrated ${migrated.phrases.length} phrases to store format`);
            return migrated;
        }

        return {
            phrases: Array.isArray(parsed?.phrases)
                ? parsed.phrases.filter((p: Phrase) => p?.text).map(normalizePhrase)
                : [],
            settings: normalizeSettings(parsed?.settings),
            updatedAt: Number(parsed?.updatedAt) || 0,
        };
    } catch (e) {
        console.error(`${TAG} parse failed:`, e);
        return { phrases: [], settings: { ...DEFAULT_SETTINGS }, updatedAt: 0 };
    }
}

async function writeLocalStore(store: PhraseStore): Promise<void> {
    try {
        await writeRaw(JSON.stringify({ version: 2, ...store }));
    } catch (e) {
        console.error(`${TAG} write failed:`, e);
    }
}

const SYNC_TIMEOUT_MS = 5_000;

/** Schickt den Stand ins Backend. Wirft NICHT: der lokale Stand ist der UI-Stand. */
async function pushPhraseStore(store: PhraseStore): Promise<void> {
    try {
        const response = await fetch(BACKEND_PHRASES_URL, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
            body: JSON.stringify(store),
            signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (e) {
        console.warn(`${TAG} Push failed:`, e);
    }
}

/**
 * Speichert eine Änderung des Nutzers: lokal sofort, danach im Hintergrund im
 * Backend. Der Zeitstempel entscheidet beim Abgleich, welcher Stand neuer ist.
 */
export async function savePhraseStore(store: PhraseStore): Promise<void> {
    const stamped: PhraseStore = { ...store, updatedAt: Date.now() };
    await writeLocalStore(stamped);
    pushPhraseStore(stamped);
}

/**
 * Gleicht den lokalen Stand mit dem Backend ab (nach dem Laden, im Hintergrund):
 *  - Backend leer oder älter  → lokalen Stand hochladen
 *  - Backend neuer            → übernehmen und lokal speichern (wird zurückgegeben)
 * Gibt nur dann einen Stand zurück, wenn die UI ihn übernehmen soll. Offline
 * oder bei Fehlern: null, der lokale Stand bleibt unverändert.
 */
export async function syncPhraseStore(local: PhraseStore): Promise<PhraseStore | null> {
    try {
        const response = await fetch(BACKEND_PHRASES_URL, {
            headers: await authHeaders(),
            signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const remote = await response.json(); // null, wenn noch nichts gespeichert ist

        const localAt = local.updatedAt ?? 0;
        const remoteAt = Number(remote?.updatedAt) || 0;

        if (remote === null || localAt > remoteAt) {
            await pushPhraseStore({ ...local, updatedAt: localAt });
            return null;
        }
        if (remoteAt <= localAt) return null;

        // Hat der Nutzer während des Abrufs etwas geändert, nicht überschreiben.
        const current = await loadPhraseStore();
        if ((current.updatedAt ?? 0) !== localAt) return null;

        const adopted: PhraseStore = {
            phrases: Array.isArray(remote.phrases)
                ? remote.phrases.filter((p: Phrase) => p?.text).map(normalizePhrase)
                : [],
            settings: normalizeSettings(remote.settings),
            updatedAt: remoteAt,
        };
        await writeLocalStore(adopted);
        console.log(`${TAG} Adopted newer phrases from backend (${adopted.phrases.length})`);
        return adopted;
    } catch (e) {
        console.warn(`${TAG} Sync failed, keeping local phrases:`, e);
        return null;
    }
}

// Verschiebt eine Phrase von einer Position auf eine andere (Drag & Drop
// sowie Pfeiltasten nutzen denselben Weg).
export function reorder(phrases: Phrase[], from: number, to: number): Phrase[] {
    if (from === to || from < 0 || to < 0 || from >= phrases.length || to >= phrases.length) {
        return phrases;
    }
    const next = [...phrases];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}

// Lädt die Audio-Dateien der Phrasen einmalig in den TTS-Cache.
// Zweck: Beim Antippen soll *nichts* mehr geladen werden — die Antwort kommt
// sofort, auch wenn das Netz gerade langsam ist oder ganz fehlt. Läuft
// nacheinander (nicht parallel), damit das Backend beim App-Start nicht
// von einem Dutzend Requests gleichzeitig getroffen wird.
export async function prewarmPhrases(
    phrases: Phrase[],
    isAvailable: boolean,
    voice: string,
    model: string,
): Promise<number> {
    if (!isAvailable) return 0;
    let ok = 0;
    for (const p of phrases) {
        const text = p.text.trim();
        if (!text) continue;
        const uri = await getShareableAudioUri(text, true, voice, model);
        if (uri) ok += 1;
    }
    console.log(`${TAG} Prewarmed ${ok}/${phrases.length} phrases`);
    return ok;
}
