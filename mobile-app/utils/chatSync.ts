import { Chat, withMessageIds } from './types';
import { readChats, writeChats } from './chatStorage';
import { BACKEND_CHATS_URL } from './config';
import { backendFetch } from './backend';

const TAG = '[myEcho][Sync]';

function parseChats(raw: string | null): Chat[] {
    if (!raw) return [];
    try {
        return withMessageIds(JSON.parse(raw) as Chat[]);
    } catch {
        return [];
    }
}

/** For the same chat the one with more messages wins, otherwise the newer one. */
function pickRicher(a: Chat, b: Chat): Chat {
    if (a.messages.length !== b.messages.length) {
        return a.messages.length > b.messages.length ? a : b;
    }
    return (a.timestamp ?? 0) >= (b.timestamp ?? 0) ? a : b;
}

/** Joins local and backend chats by id, newest first. A local chat is never lost. */
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

export async function loadLocalChats(): Promise<Chat[]> {
    return parseChats(await readChats());
}

/**
 * Merges local chats with the backend and pushes what the backend is missing.
 * Returns null when offline. Does not write the local cache: the caller does
 * that with its current state, so a late result cannot overwrite newer edits.
 */
export async function syncChats(local: Chat[]): Promise<Chat[] | null> {
    try {
        const response = await backendFetch(BACKEND_CHATS_URL);
        const remote = withMessageIds((await response.json()) as Chat[]);

        const merged = mergeChats(local, remote);

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

// Max wait for the backend at app start when local chats exist.
const START_GRACE_MS = 600;
const GRACE_EXPIRED = Symbol('grace expired');

/**
 * Chats for app start, so a slow network does not block the screen.
 * If the backend is slow, the local chats come now and `later` brings the sync.
 * On a new device (nothing local) we wait: otherwise an empty welcome chat
 * could overwrite an existing chat with the same id.
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

/** Saves a chat in the backend. Never throws: the local cache is the source for the UI. */
export async function pushChat(chat: Chat): Promise<void> {
    try {
        await backendFetch(`${BACKEND_CHATS_URL}/${chat.id}`, { method: 'PUT', json: chat });
    } catch (e) {
        console.warn(`${TAG} Push failed for chat ${chat.id}:`, e);
    }
}

export async function deleteChatRemote(chatId: string): Promise<void> {
    try {
        await backendFetch(`${BACKEND_CHATS_URL}/${chatId}`, { method: 'DELETE' });
    } catch (e) {
        console.warn(`${TAG} Delete failed for chat ${chatId}:`, e);
    }
}

export async function persistLocal(chats: Chat[]): Promise<void> {
    await writeChats(JSON.stringify(chats));
}
