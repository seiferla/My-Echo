import { Chat } from './types';
import { storage } from './storage';
import { BACKEND_CHATS_URL } from './config';

const TAG = '[myEcho][Sync]';
const STORAGE_KEY = 'myEchoChats';
const FETCH_TIMEOUT_MS = 5_000;

/**
 * Liefert Chats für den App-Start:
 * 1. Versucht das Backend (Wahrheit) → bei Erfolg lokal cachen
 * 2. Fallback auf SecureStore-Cache (offline)
 */
export async function loadChats(): Promise<Chat[]> {
    try {
        const response = await fetch(BACKEND_CHATS_URL, {
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const chats: Chat[] = await response.json();
        await storage.setItem(STORAGE_KEY, JSON.stringify(chats));
        console.log(`${TAG} Loaded ${chats.length} chats from backend`);
        return chats;
    } catch (e) {
        console.warn(`${TAG} Backend unreachable, falling back to cache:`, e);
        const raw = await storage.getItem(STORAGE_KEY);
        return raw ? (JSON.parse(raw) as Chat[]) : [];
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