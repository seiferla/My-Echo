import { Chat, withMessageIds } from './types';
import { readChats, writeChats } from './chatStorage';
import { BACKEND_CHATS_URL } from './config';
import { authHeaders } from './supabase';

const TAG = '[myEcho][Sync]';
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
export function mergeChats(local: Chat[], remote: Chat[]): Chat[] {
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

/** Der lokale Verlauf dieses Kontos. Schnell: kein Netz nötig. */
export async function loadLocalChats(): Promise<Chat[]> {
    return parseChats(await readChats());
}

/**
 * Gleicht lokale Chats mit dem Backend ab. Der lokale Verlauf ist immer der
 * Sockel: das Backend kann ihn nur ergänzen, niemals löschen.
 *
 *  - Backend-Chats, die lokal fehlen, werden dazugenommen (id-basiert).
 *  - Lokale Chats, die das Backend noch nicht (oder nur ärmer) kennt, werden
 *    hochgepusht (verlustfreie Seed-Migration in die Backend-DB).
 *
 * Gibt den vereinigten Stand zurück, oder null offline / bei Fehlern.
 * Schreibt NICHT in den lokalen Cache: das macht der Aufrufer mit seinem
 * aktuellen Stand, damit ein spät eintreffender Abgleich Änderungen des
 * Nutzers nicht mit einem veralteten Stand überschreibt.
 */
export async function syncChats(local: Chat[]): Promise<Chat[] | null> {
    try {
        const response = await fetch(BACKEND_CHATS_URL, {
            headers: await authHeaders(),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const remote = withMessageIds((await response.json()) as Chat[]);

        const merged = mergeChats(local, remote);

        // Alles, was das Backend nicht oder nur ärmer/anders kennt, nach oben
        // schreiben. Identische Remote-Chats werden nicht erneut gepusht.
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

        console.log(
            `${TAG} Merged ${remote.length} remote + ${local.length} local → ${merged.length} chats`
        );
        return merged;
    } catch (e) {
        console.warn(`${TAG} Backend unreachable, using local cache:`, e);
        return null;
    }
}

/** Lokal lesen, abgleichen und den Cache aktualisieren (für Stellen ohne eigenen State). */
export async function loadChats(): Promise<Chat[]> {
    const local = await loadLocalChats();
    const merged = await syncChats(local);
    if (!merged) return local;
    await writeChats(JSON.stringify(merged));
    return merged;
}

// So lange wartet der App-Start höchstens auf das Backend, wenn lokale Chats da
// sind. Danach werden sie sofort gezeigt und der Abgleich folgt nachträglich.
const START_GRACE_MS = 600;
const GRACE_EXPIRED = Symbol('grace expired');

/**
 * Chats für den App-Start, ohne dass ein langsames Netz die Anzeige blockiert.
 *  - Lokale Chats vorhanden: Antwortet das Backend schnell (< 0,6 s), kommt der
 *    abgeglichene Stand zurück. Sonst die lokalen Chats sofort, und `later`
 *    liefert den Abgleich nachträglich.
 *  - Nichts lokal (neues Gerät): auf das Backend warten. Sonst würde eine leere
 *    Begrüßungs-Hülle einen vorhandenen Chat mit gleicher ID überschreiben.
 */
export async function loadChatsForStart(): Promise<{
    chats: Chat[];
    later: Promise<Chat[] | null> | null;
}> {
    const local = await loadLocalChats();
    const sync = syncChats(local);

    if (local.length === 0) {
        return { chats: (await sync) ?? local, later: null };
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    const grace = new Promise<typeof GRACE_EXPIRED>((resolve) => {
        timer = setTimeout(() => resolve(GRACE_EXPIRED), START_GRACE_MS);
    });
    const first = await Promise.race([sync, grace]);
    clearTimeout(timer);

    if (first === GRACE_EXPIRED) return { chats: local, later: sync };
    return { chats: first ?? local, later: null };
}

/**
 * Schreibt einen Chat ins Backend. Wirft NICHT — Fehler werden geloggt,
 * der lokale Cache ist die Wahrheit für die UI.
 */
export async function pushChat(chat: Chat): Promise<void> {
    try {
        const response = await fetch(`${BACKEND_CHATS_URL}/${chat.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
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
            headers: await authHeaders(),
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
    await writeChats(JSON.stringify(chats));
}