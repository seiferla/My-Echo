export interface ChatMessage {
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
