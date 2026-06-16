export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp?: number;
    via?: 'send' | 'save';
    editCount?: number;
}

export interface Chat {
    id: string;
    title: string;
    messages: ChatMessage[];
    timestamp: number;
    pinned?: boolean;
}

// Stabile, eindeutige ID für eine Nachricht. Dient als React-`key`, damit
// Message-Instanzen beim Chat-Wechsel nicht positionsbasiert wiederverwendet
// werden — sonst „klebt" z.B. der isPlaying-State an der falschen Bubble und
// der Mount-Effekt (autoPlay/Cleanup) läuft nicht korrekt.
export function newMessageId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Backfill für Chats, die noch vor Einführung der Message-IDs im Storage
// gespeichert wurden. Vergibt fehlende IDs, lässt vorhandene unangetastet.
export function withMessageIds(chats: Chat[]): Chat[] {
    return chats.map((chat) => ({
        ...chat,
        messages: chat.messages.map((m) =>
            m.id ? m : { ...m, id: newMessageId() }
        ),
    }));
}
