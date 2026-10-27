import React, { useState, useEffect } from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
    Text,
    Modal,
    Dimensions,
    Animated,
    TouchableWithoutFeedback
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Menu, PenSquare } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { Sidebar } from '../components/Sidebar';
import { ChatArea } from '../components/ChatArea';
import { useCloudStatus } from '../context/CloudStatusContext';
import { Chat, ChatMessage, withMessageIds } from '../utils/types';
import { loadChatsForStart, mergeChats, pushChat, deleteChatRemote, persistLocal } from '../utils/chatSync';

const { width } = Dimensions.get('window');

export default function ChatScreen() {
    const router = useRouter();
    const insets = useSafeAreaInsets();
    const { isAvailable } = useCloudStatus();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
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
                const newChat: Chat = {
                    id: Date.now().toString(),
                    title: 'Neuer Chat',
                    messages: [],
                    timestamp: Date.now(),
                };
                const updated = [newChat, ...loaded];
                setChats(updated);
                setCurrentChatId(newChat.id);
                pushChat(newChat);
            } else if (loaded.length > 0) {
                setChats(loaded);
                setCurrentChatId(loaded[0].id);
            } else {
                // No chats at all: create an empty welcome chat.
                const fresh: Chat = {
                    id: '1',
                    title: 'Neuer Chat',
                    messages: [],
                    timestamp: Date.now(),
                };
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

    const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

    const createNewChat = () => {
        const newChat: Chat = {
            id: Date.now().toString(),
            title: 'Neuer Chat',
            messages: [],
            timestamp: Date.now(),
        };
        setChats([newChat, ...chats]);
        setCurrentChatId(newChat.id);
        setIsSidebarOpen(false);
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
                const fresh = { id: Date.now().toString(), title: 'Neuer Chat', messages: [], timestamp: Date.now() };
                pushChat(fresh);
                return [fresh];
            }
            if (id === currentChatId) {
                setCurrentChatId(newChats[0].id);
            }
            return newChats;
        });
    };

    const selectChat = (id: string) => {
        setCurrentChatId(id);
        setIsSidebarOpen(false);
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

    return (
        <View style={styles.container}>
            {/* Custom Header */}
            <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
                <TouchableOpacity onPress={toggleSidebar} style={styles.headerIcon}>
                    <Menu size={24} color="#374151" />
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle}>myEcho</Text>
                    <View style={[
                        styles.statusDot,
                        { backgroundColor: isAvailable ? '#22c55e' : '#d1d5db' }
                    ]} />
                </View>
                <TouchableOpacity onPress={createNewChat} style={styles.headerIcon}>
                    <PenSquare size={24} color="#0ea5e9" />
                </TouchableOpacity>
            </View>

            {/* Main Chat Area */}
            <View style={styles.content}>
                <ChatArea
                    chat={currentChat}
                    onUpdateChat={(messages) => updateChat(currentChatId, messages)}
                />
            </View>

            {/* Sidebar Modal (Drawer-like) */}
            <Modal
                transparent={true}
                visible={isSidebarOpen}
                animationType="none"
                onRequestClose={() => setIsSidebarOpen(false)}
            >
                <View style={styles.modalOverlay}>
                    <TouchableWithoutFeedback onPress={() => setIsSidebarOpen(false)}>
                        <View style={styles.modalBackground} />
                    </TouchableWithoutFeedback>
                    <Animated.View style={styles.sidebarWrapper}>
                        <Sidebar
                            chats={chats}
                            currentChatId={currentChatId}
                            onSelectChat={selectChat}
                            onNewChat={createNewChat}
                            onPinChat={pinChat}
                            onRenameChat={renameChat}
                            onDeleteChat={deleteChat}
                            onClose={() => setIsSidebarOpen(false)}
                        />
                    </Animated.View>
                </View>
            </Modal>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
        backgroundColor: '#ffffff',
    },
    headerIcon: {
        padding: 8,
    },
    headerTitleContainer: {
        flex: 1,
        alignItems: 'center',
        flexDirection: 'row',
        justifyContent: 'center',
        gap: 6,
    },
    statusDot: {
        width: 8,
        height: 8,
        borderRadius: 4,
        marginTop: 2,
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
    },
    content: {
        flex: 1,
    },
    modalOverlay: {
        flex: 1,
        flexDirection: 'row',
    },
    modalBackground: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
    },
    sidebarWrapper: {
        backgroundColor: '#ffffff',
        height: '100%',
        width: width * 0.85,
        maxWidth: 320,
    }
});
