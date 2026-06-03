import React, { useState, useEffect } from 'react';
import { 
    View, 
    StyleSheet, 
    SafeAreaView,
    TouchableOpacity,
    Text,
    Modal,
    Dimensions,
    Animated,
    TouchableWithoutFeedback
} from 'react-native';
import { Menu, PenSquare, BarChart3 } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { Sidebar } from '../components/Sidebar';
import { ChatArea } from '../components/ChatArea';
import { storage } from '../utils/storage';

const { width } = Dimensions.get('window');

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

interface Chat {
    id: string;
    title: string;
    messages: ChatMessage[];
    timestamp: number;
    pinned?: boolean;
}

export default function ChatScreen() {
    const router = useRouter();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const [currentChatId, setCurrentChatId] = useState('1');
    const [chats, setChats] = useState<Chat[]>([
        { id: '1', title: 'Neuer Chat', messages: [], timestamp: Date.now() },
    ]);

    // Lade Chats aus SecureStore beim Start
    useEffect(() => {
        const loadChats = async () => {
            const savedChats = await storage.getItem('myEchoChats');
            if (savedChats) {
                try {
                    const parsed: Chat[] = JSON.parse(savedChats);
                    
                    // Prüfe ob ein neuer Chat für heute erstellt werden muss
                    const today = new Date().setHours(0, 0, 0, 0);
                    const latestChat = parsed[0]; // Chats sind nach timestamp absteigend sortiert (neuere oben)
                    
                    if (latestChat && new Date(latestChat.timestamp).setHours(0, 0, 0, 0) < today) {
                        const newChat: Chat = {
                            id: Date.now().toString(),
                            title: 'Neuer Chat',
                            messages: [],
                            timestamp: Date.now(),
                        };
                        const updatedChats = [newChat, ...parsed];
                        setChats(updatedChats);
                        setCurrentChatId(newChat.id);
                    } else {
                        setChats(parsed);
                        if (parsed.length > 0) {
                            setCurrentChatId(parsed[0].id);
                        }
                    }
                } catch (e) {
                    console.error('Fehler beim Laden der Chats:', e);
                }
            }
        };
        loadChats();
    }, []);

    // Speichere Chats bei Änderungen
    useEffect(() => {
        storage.setItem('myEchoChats', JSON.stringify(chats));
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
            chat.id === id ? { ...chat, title: newTitle } : chat
        ));
    };

    const deleteChat = (id: string) => {
        setChats(prevChats => {
            const newChats = prevChats.filter(chat => chat.id !== id);
            if (newChats.length === 0) {
                return [{ id: Date.now().toString(), title: 'Neuer Chat', messages: [], timestamp: Date.now() }];
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
                ? { ...chat, messages, title: messages[0]?.content.slice(0, 30) || 'Neuer Chat' }
                : chat
        ));
    };

    const currentChat = chats.find(chat => chat.id === currentChatId);

    return (
        <SafeAreaView style={styles.container}>
            {/* Custom Header */}
            <View style={styles.header}>
                <TouchableOpacity onPress={toggleSidebar} style={styles.headerIcon}>
                    <Menu size={24} color="#374151" />
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle}>myEcho</Text>
                </View>
                <TouchableOpacity onPress={() => router.push('/stats')} style={styles.headerIcon}>
                    <BarChart3 size={24} color="#374151" />
                </TouchableOpacity>
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
        </SafeAreaView>
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
        paddingVertical: 12,
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
