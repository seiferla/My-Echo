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
    // Set after a manual rename, so updateChat() no longer builds the title from messages[0].
    titleIsCustom?: boolean;
    messages: ChatMessage[];
    timestamp: number;
    pinned?: boolean;
}

// Stable, unique message id. Used as React `key`, so Message components are not
// reused by position on chat change (else e.g. isPlaying sticks to the wrong
// bubble and the mount effect for autoPlay/cleanup does not run).
export function newMessageId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

// Adds missing ids to chats saved before message ids existed. Keeps existing ids.
export function withMessageIds(chats: Chat[]): Chat[] {
    return chats.map((chat) => ({
        ...chat,
        messages: chat.messages.map((m) =>
            m.id ? m : { ...m, id: newMessageId() }
        ),
    }));
}
