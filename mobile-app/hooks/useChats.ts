import { useEffect, useState } from 'react';
import { Chat, ChatMessage } from '../utils/types';
import { loadChatsForStart, mergeChats, pushChat, deleteChatRemote, persistLocal } from '../utils/chatSync';

function createEmptyChat(id = Date.now().toString()): Chat {
    return { id, title: 'Neuer Chat', messages: [], timestamp: Date.now() };
}

/**
 * The chat list of the signed-in user and the open chat.
 * Loads the chats at start, saves every change locally and pushes the open chat to the backend.
 */
export function useChats() {
    const [currentChatId, setCurrentChatId] = useState('1');
    const [chats, setChats] = useState<Chat[]>([]);

    useEffect(() => {
        let alive = true;
        loadChatsForStart().then(({ chats: loaded, later }) => {
            if (!alive) return;
            // A new day starts with a new chat.
            const today = new Date().setHours(0, 0, 0, 0);
            const latest = loaded[0];
            if (latest && new Date(latest.timestamp).setHours(0, 0, 0, 0) < today) {
                const newChat = createEmptyChat();
                const updated = [newChat, ...loaded];
                setChats(updated);
                setCurrentChatId(newChat.id);
                pushChat(newChat);
            } else if (loaded.length > 0) {
                setChats(loaded);
                setCurrentChatId(loaded[0].id);
            } else {
                // No chats at all: create an empty welcome chat.
                const fresh = createEmptyChat('1');
                setChats([fresh]);
                pushChat(fresh);
            }

            // Slow backend: merge its result later without losing changes made meanwhile.
            later?.then((merged) => {
                if (!alive || !merged) return;
                setChats((prev) => mergeChats(prev, merged));
            });
        });
        return () => {
            alive = false;
        };
    }, []);

    useEffect(() => {
        if (chats.length === 0) return;
        persistLocal(chats);
        // Push only the current chat, not all of them.
        const current = chats.find((c) => c.id === currentChatId);
        if (current) pushChat(current);
    }, [chats]);

    const createChat = () => {
        const newChat = createEmptyChat();
        setChats([newChat, ...chats]);
        setCurrentChatId(newChat.id);
    };

    const pinChat = (id: string) => {
        setChats(prevChats => prevChats.map(chat =>
            chat.id === id ? { ...chat, pinned: !chat.pinned } : chat
        ));
    };

    const renameChat = (id: string, newTitle: string) => {
        setChats(prevChats => prevChats.map(chat =>
            chat.id === id ? { ...chat, title: newTitle, titleIsCustom: true } : chat
        ));
    };

    const deleteChat = (id: string) => {
        deleteChatRemote(id);
        setChats(prevChats => {
            const newChats = prevChats.filter(chat => chat.id !== id);
            if (newChats.length === 0) {
                const fresh = createEmptyChat();
                pushChat(fresh);
                return [fresh];
            }
            if (id === currentChatId) {
                setCurrentChatId(newChats[0].id);
            }
            return newChats;
        });
    };

    const updateChat = (id: string, messages: ChatMessage[]) => {
        setChats(prevChats => prevChats.map(chat =>
            chat.id === id
                ? {
                    ...chat,
                    messages,
                    // Keep a manual title; else every message would rebuild it from messages[0].
                    title: chat.titleIsCustom
                        ? chat.title
                        : messages[0]?.content.slice(0, 30) || 'Neuer Chat',
                }
                : chat
        ));
    };

    const currentChat = chats.find(chat => chat.id === currentChatId);

    return {
        chats,
        currentChat,
        currentChatId,
        selectChat: setCurrentChatId,
        createChat,
        pinChat,
        renameChat,
        deleteChat,
        updateChat,
    };
}
