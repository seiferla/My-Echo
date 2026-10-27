import { File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';
import { storage } from './storage';
import { getShareableAudioUri } from './tts';
import { scoped } from './localUser';
import { BACKEND_PHRASES_URL } from './config';
import { backendFetch } from './backend';

const TAG = '[myEcho][Phrases]';

// Like chatStorage.ts: web has no file system, so it uses localStorage
// through the storage helper. The File object is created on demand.
const isWeb = Platform.OS === 'web';
const WEB_KEY_BASE = 'myEchoPhrases';

// One file per account (see localUser.ts). Not cached: the name changes when the account changes.
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
    // How many phrases the ChatArea shows (0 = hidden).
    visibleCount: number;
    // For all phrases together:
    //   on  → a tap sends and speaks at once (fastest answer)
    //   off → a tap only puts the text into the input (nothing is spoken)
    instantEnabled: boolean;
}

export interface PhraseStore {
    phrases: Phrase[];
    settings: PhraseSettings;
    // Last change in ms; the newer store wins on sync. 0 = untouched default phrases.
    updatedAt?: number;
}

// Limit for the ChatArea. More chips would make the screen busy and each
// touch target smaller.
export const MAX_VISIBLE_PHRASES = 3;

export const DEFAULT_SETTINGS: PhraseSettings = {
    visibleCount: 3,
    instantEnabled: true,
};

export function newPhraseId(): string {
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// Default phrases for a new install. Without them the feature would start
// empty; the quick one-word answers ("Ja", "Nein") are its main value.
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

// Keeps only today's fields. Older files had an "instant" flag per phrase,
// which the global switch replaced.
function normalizePhrase(p: Phrase): Phrase {
    return {
        id: p.id || newPhraseId(),
        text: p.text,
        useCount: p.useCount ?? 0,
        lastUsedAt: p.lastUsedAt,
        createdAt: p.createdAt ?? Date.now(),
    };
}

function normalizePhrases(raw: unknown): Phrase[] {
    return Array.isArray(raw) ? raw.filter((p: Phrase) => p?.text).map(normalizePhrase) : [];
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
        // updatedAt 0: the default phrases must never overwrite a real store from the backend.
        const initial: PhraseStore = { phrases: seed(), settings: { ...DEFAULT_SETTINGS }, updatedAt: 0 };
        await writeLocalStore(initial);
        console.log(`${TAG} Seeded ${initial.phrases.length} default phrases`);
        return initial;
    }

    try {
        const parsed = JSON.parse(raw);

        // Version 1 stored a plain array. Migrate it once to the store format.
        if (Array.isArray(parsed)) {
            const migrated: PhraseStore = {
                phrases: normalizePhrases(parsed),
                settings: { ...DEFAULT_SETTINGS },
                updatedAt: Date.now(),
            };
            await writeLocalStore(migrated);
            console.log(`${TAG} Migrated ${migrated.phrases.length} phrases to store format`);
            return migrated;
        }

        return {
            phrases: normalizePhrases(parsed?.phrases),
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

/** Never throws: the local store is what the UI shows. */
async function pushPhraseStore(store: PhraseStore): Promise<void> {
    try {
        await backendFetch(BACKEND_PHRASES_URL, { method: 'PUT', json: store });
    } catch (e) {
        console.warn(`${TAG} Push failed:`, e);
    }
}

/** Saves a user change locally now and in the backend in the background. */
export async function savePhraseStore(store: PhraseStore): Promise<void> {
    const stamped: PhraseStore = { ...store, updatedAt: Date.now() };
    await writeLocalStore(stamped);
    void pushPhraseStore(stamped);
}

/**
 * Syncs with the backend: the newer store wins. Returns the backend store only
 * when the UI should show it; otherwise (or offline) null.
 */
export async function syncPhraseStore(local: PhraseStore): Promise<PhraseStore | null> {
    try {
        const response = await backendFetch(BACKEND_PHRASES_URL);
        const remote = await response.json(); // null if nothing is stored yet

        const localAt = local.updatedAt ?? 0;
        const remoteAt = Number(remote?.updatedAt) || 0;

        if (remote === null || localAt > remoteAt) {
            await pushPhraseStore({ ...local, updatedAt: localAt });
            return null;
        }
        if (remoteAt === localAt) return null;

        // Do not overwrite a change the user made while we waited.
        const current = await loadPhraseStore();
        if ((current.updatedAt ?? 0) !== localAt) return null;

        const adopted: PhraseStore = {
            phrases: normalizePhrases(remote.phrases),
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

// Moves a phrase from one position to another (used by drag & drop and the arrows).
export function reorder(phrases: Phrase[], from: number, to: number): Phrase[] {
    if (from === to || from < 0 || to < 0 || from >= phrases.length || to >= phrases.length) {
        return phrases;
    }
    const next = [...phrases];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    return next;
}

// Loads the audio of the phrases into the TTS cache once, so a tap plays at
// once, even with a slow or no network. Runs one by one (not in parallel),
// so the backend does not get a dozen requests at app start.
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
