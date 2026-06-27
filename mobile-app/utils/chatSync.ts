import { Chat, withMessageIds } from './types';
import { storage } from './storage';
import { BACKEND_CHATS_URL } from './config';

const TAG = '[myEcho][Sync]';
const STORAGE_KEY = 'myEchoChats';
const FETCH_TIMEOUT_MS = 5_000;

function parseChats(raw: string | null): Chat[] {
    if (!raw) return [];
    try {
        return withMessageIds(JSON.parse(raw) as Chat[]);
    } catch {
        return [];
    }
}

/** Bei gleichem Chat gewinnt der "reichere" (mehr Nachrichten), sonst der neuere. */
function pickRicher(a: Chat, b: Chat): Chat {
    if (a.messages.length !== b.messages.length) {
        return a.messages.length > b.messages.length ? a : b;
    }
    return (a.timestamp ?? 0) >= (b.timestamp ?? 0) ? a : b;
}

/**
 * Vereinigt lokale und Backend-Chats nach id. Ein lokal vorhandener Chat geht
 * NIE verloren — selbst wenn das Backend ihn (noch) nicht kennt oder leer ist.
 * Sortiert absteigend nach timestamp (neuester zuerst), wie index.tsx erwartet.
 */
function mergeChats(local: Chat[], remote: Chat[]): Chat[] {
    const byId = new Map<string, Chat>();
    for (const c of remote) byId.set(c.id, c);
    for (const c of local) {
        const existing = byId.get(c.id);
        byId.set(c.id, existing ? pickRicher(c, existing) : c);
    }
    return [...byId.values()].sort(
        (a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)
    );
}

/**
 * Liefert Chats für den App-Start. Wichtig: der lokale Verlauf ist immer der
 * Sockel — das Backend kann ihn nur ergänzen, niemals löschen.
 *
 * 1. Lokalen Cache lesen (bestehender Verlauf der installierten App).
 * 2. Backend abfragen und mit dem lokalen Stand mergen (id-basiert).
 * 3. Lokale Chats, die das Backend noch nicht (oder nur ärmer) kennt, hoch-
 *    pushen — einmalige verlustfreie Seed-Migration in die Backend-DB.
 * 4. Gemergten Stand cachen und zurückgeben.
 *
 * Offline / Backend nicht erreichbar → reiner lokaler Verlauf, ohne Verlust.
 */
export async function loadChats(): Promise<Chat[]> {
    const local = parseChats(await storage.getItem(STORAGE_KEY));

    try {
        const response = await fetch(BACKEND_CHATS_URL, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const remote = withMessageIds((await response.json()) as Chat[]);

        const merged = mergeChats(local, remote);

        // Seed/Reparatur: alles, was das Backend nicht oder nur ärmer/anders
        // kennt, nach oben schreiben, damit der bestehende Verlauf dauerhaft
        // sicher ist. Identische Remote-Chats werden nicht erneut gepusht.
        const remoteById = new Map(remote.map((c) => [c.id, c]));
        for (const c of merged) {
            const r = remoteById.get(c.id);
            if (
                !r ||
                c.messages.length !== r.messages.length ||
                (c.timestamp ?? 0) !== (r.timestamp ?? 0)
            ) {
                pushChat(c);
            }
        }

        await storage.setItem(STORAGE_KEY, JSON.stringify(merged));
        console.log(
            `${TAG} Merged ${remote.length} remote + ${local.length} local → ${merged.length} chats`
        );
        return merged;
    } catch (e) {
        console.warn(`${TAG} Backend unreachable, using local cache:`, e);
        return local;
    }
}

/**
 * Schreibt einen Chat ins Backend. Wirft NICHT — Fehler werden geloggt,
 * der lokale Cache ist die Wahrheit für die UI.
 */
export async function pushChat(chat: Chat): Promise<void> {
    try {
        const response = await fetch(`${BACKEND_CHATS_URL}/${chat.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chat),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (e) {
        console.warn(`${TAG} Push failed for chat ${chat.id}:`, e);
    }
}

export async function deleteChatRemote(chatId: string): Promise<void> {
    try {
        await fetch(`${BACKEND_CHATS_URL}/${chatId}`, {
            method: 'DELETE',
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
    } catch (e) {
        console.warn(`${TAG} Delete failed for chat ${chatId}:`, e);
    }
}

/**
 * Persistiert alle Chats lokal (SecureStore-Cache). Wird parallel zum
 * Backend-Push aufgerufen — der lokale Cache ist immer der UI-Stand.
 */
export async function persistLocal(chats: Chat[]): Promise<void> {
    await storage.setItem(STORAGE_KEY, JSON.stringify(chats));
}