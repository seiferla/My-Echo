import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { storage } from './storage';
import { getShareableAudioUri } from './tts';

const TAG = '[myEcho][Phrases]';

// Wie in chatStorage.ts: im Web kein Dateisystem, also localStorage über den
// storage-Helper. Die File-Instanz wird erst beim ersten Zugriff erzeugt.
const isWeb = Platform.OS === 'web';
const WEB_KEY = 'myEchoPhrases';

let _phrasesFile: File | null = null;
function phrasesFileRef(): File {
    if (!_phrasesFile) _phrasesFile = new File(Paths.document, 'phrases.json');
    return _phrasesFile;
}

async function readRaw(): Promise<string | null> {
    if (isWeb) return storage.getItem(WEB_KEY);
    return phrasesFileRef().exists ? phrasesFileRef().textSync() : null;
}

async function writeRaw(json: string): Promise<void> {
    if (isWeb) return storage.setItem(WEB_KEY, json);
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
        const initial: PhraseStore = { phrases: seed(), settings: { ...DEFAULT_SETTINGS } };
        await savePhraseStore(initial);
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
            };
            await savePhraseStore(migrated);
            console.log(`${TAG} Migrated ${migrated.phrases.length} phrases to store format`);
            return migrated;
        }

        return {
            phrases: Array.isArray(parsed?.phrases)
                ? parsed.phrases.filter((p: Phrase) => p?.text).map(normalizePhrase)
                : [],
            settings: normalizeSettings(parsed?.settings),
        };
    } catch (e) {
        console.error(`${TAG} parse failed:`, e);
        return { phrases: [], settings: { ...DEFAULT_SETTINGS } };
    }
}

export async function savePhraseStore(store: PhraseStore): Promise<void> {
    try {
        await writeRaw(JSON.stringify({ version: 2, ...store }));
    } catch (e) {
        console.error(`${TAG} write failed:`, e);
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
