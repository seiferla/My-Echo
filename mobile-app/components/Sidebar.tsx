import React, { useState } from 'react';
import { 
    View, 
    Text, 
    TouchableOpacity, 
    ScrollView, 
    StyleSheet, 
    SafeAreaView,
    Dimensions,
    Modal,
    TouchableWithoutFeedback,
    TextInput,
    Alert
} from 'react-native';
import { Plus, MessageSquare, Pin, Pencil, Trash2 } from 'lucide-react-native';
import { useRouter } from 'expo-router';

const { width } = Dimensions.get('window');

interface Chat {
    id: string;
    title: string;
    messages: any[];
    timestamp: number;
    pinned?: boolean;
}

interface SidebarProps {
    chats: Chat[];
    currentChatId: string;
    onSelectChat: (id: string) => void;
    onNewChat: () => void;
    onPinChat: (id: string) => void;
    onRenameChat: (id: string, newTitle: string) => void;
    onDeleteChat: (id: string) => void;
    onClose: () => void;
}

export function Sidebar({ 
    chats, 
    currentChatId, 
    onSelectChat, 
    onNewChat, 
    onPinChat,
    onRenameChat,
    onDeleteChat,
    onClose 
}: SidebarProps) {
    const router = useRouter();
    const [selectedChatId, setSelectedChatId] = useState<string | null>(null);
    const [isMenuVisible, setIsMenuVisible] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [newTitle, setNewTitle] = useState('');

    const handleSelectChat = (id: string) => {
        onSelectChat(id);
        onClose();
    };

    const handleLongPress = (id: string, currentTitle: string) => {
        setSelectedChatId(id);
        setNewTitle(currentTitle);
        setIsMenuVisible(true);
    };

    const handlePin = () => {
        if (selectedChatId) {
            onPinChat(selectedChatId);
            setIsMenuVisible(false);
        }
    };

    const handleRename = () => {
        setIsMenuVisible(false);
        setIsRenaming(true);
    };

    const submitRename = () => {
        if (selectedChatId && newTitle.trim()) {
            onRenameChat(selectedChatId, newTitle.trim());
            setIsRenaming(false);
            setSelectedChatId(null);
        }
    };

    const handleDelete = () => {
        if (selectedChatId) {
            Alert.alert(
                "Chat löschen",
                "Möchten Sie diesen Chat wirklich löschen?",
                [
                    { text: "Abbrechen", style: "cancel", onPress: () => setIsMenuVisible(false) },
                    { 
                        text: "Löschen", 
                        style: "destructive", 
                        onPress: () => {
                            onDeleteChat(selectedChatId);
                            setIsMenuVisible(false);
                            setSelectedChatId(null);
                        } 
                    }
                ]
            );
        }
    };

    const groupChatsByDate = () => {
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        const oneWeek = 7 * oneDay;
        const oneMonth = 30 * oneDay;

        const groups: { [key: string]: Chat[] } = {
            'Gepinnt': [],
            'Heute': [],
            'Gestern': [],
            'Letzte 7 Tage': [],
            'Letzte 30 Tage': [],
            'Älter': [],
        };

        chats.forEach(chat => {
            if (chat.pinned) {
                groups['Gepinnt'].push(chat);
                return;
            }
            const diff = now - chat.timestamp;
            if (diff < oneDay) {
                groups['Heute'].push(chat);
            } else if (diff < 2 * oneDay) {
                groups['Gestern'].push(chat);
            } else if (diff < oneWeek) {
                groups['Letzte 7 Tage'].push(chat);
            } else if (diff < oneMonth) {
                groups['Letzte 30 Tage'].push(chat);
            } else {
                groups['Älter'].push(chat);
            }
        });

        return groups;
    };

    const groupedChats = groupChatsByDate();

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity
                    onPress={onNewChat}
                    style={styles.newChatButton}
                >
                    <Plus size={24} color="#374151" />
                    <Text style={styles.newChatText}>Neuer Chat</Text>
                </TouchableOpacity>


            </View>

            <ScrollView style={styles.chatList}>
                {Object.entries(groupedChats).map(([group, groupChats]) => {
                    if (groupChats.length === 0) return null;
                    return (
                        <View key={group} style={styles.groupContainer}>
                            <Text style={styles.groupTitle}>{group}</Text>
                            {groupChats.map((chat) => (
                                <TouchableOpacity
                                    key={chat.id}
                                    onPress={() => handleSelectChat(chat.id)}
                                    onLongPress={() => handleLongPress(chat.id, chat.title)}
                                    style={[
                                        styles.chatItem,
                                        chat.id === currentChatId && styles.activeChatItem
                                    ]}
                                >
                                    {chat.pinned ? (
                                        <Pin size={24} color="#0284c7" />
                                    ) : (
                                        <MessageSquare 
                                            size={28} 
                                            color={chat.id === currentChatId ? "#0284c7" : "#4b5563"} 
                                        />
                                    )}
                                    <Text 
                                        style={[
                                            styles.chatItemText,
                                            chat.id === currentChatId && styles.activeChatItemText
                                        ]}
                                        numberOfLines={1}
                                    >
                                        {chat.title}
                                    </Text>
                                </TouchableOpacity>
                            ))}
                        </View>
                    );
                })}
            </ScrollView>

            <View style={styles.footer}>
                <View style={styles.userInfo}>
                    <View style={styles.userAvatar}>
                        <Text style={styles.userAvatarText}>U</Text>
                    </View>
                    <Text style={styles.userName}>Mama🌺</Text>
                </View>
            </View>

            {/* Kontext-Menü Modal */}
            <Modal
                visible={isMenuVisible}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setIsMenuVisible(false)}
            >
                <TouchableWithoutFeedback onPress={() => setIsMenuVisible(false)}>
                    <View style={styles.menuOverlay}>
                        <View style={styles.menuContainer}>
                            <TouchableOpacity style={styles.menuItem} onPress={handlePin}>
                                <Pin size={20} color="#374151" />
                                <Text style={styles.menuItemText}>
                                    {chats.find(c => c.id === selectedChatId)?.pinned ? 'Anheften aufheben' : 'Anheften'}
                                </Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={styles.menuItem} onPress={handleRename}>
                                <Pencil size={20} color="#374151" />
                                <Text style={styles.menuItemText}>Umbenennen</Text>
                            </TouchableOpacity>
                            <TouchableOpacity style={[styles.menuItem, styles.deleteItem]} onPress={handleDelete}>
                                <Trash2 size={20} color="#ef4444" />
                                <Text style={[styles.menuItemText, styles.deleteText]}>Löschen</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </TouchableWithoutFeedback>
            </Modal>

            {/* Umbenennen Modal */}
            <Modal
                visible={isRenaming}
                transparent={true}
                animationType="fade"
                onRequestClose={() => setIsRenaming(false)}
            >
                <View style={styles.menuOverlay}>
                    <View style={styles.renameContainer}>
                        <Text style={styles.renameTitle}>Chat umbenennen</Text>
                        <TextInput
                            style={styles.renameInput}
                            value={newTitle}
                            onChangeText={setNewTitle}
                            autoFocus={true}
                            selectTextOnFocus={true}
                        />
                        <View style={styles.renameButtons}>
                            <TouchableOpacity 
                                style={styles.renameButton} 
                                onPress={() => setIsRenaming(false)}
                            >
                                <Text style={styles.renameButtonText}>Abbrechen</Text>
                            </TouchableOpacity>
                            <TouchableOpacity 
                                style={[styles.renameButton, styles.renameSubmitButton]} 
                                onPress={submitRename}
                            >
                                <Text style={[styles.renameButtonText, styles.renameSubmitButtonText]}>Speichern</Text>
                            </TouchableOpacity>
                        </View>
                    </View>
                </View>
            </Modal>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#f9fafb',
        width: width * 0.85,
        maxWidth: 320,
    },
    header: {
        padding: 20,
        gap: 12,
    },
    newChatButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#d1d5db',
        backgroundColor: '#ffffff',
    },
    newChatText: {
        fontSize: 18,
        fontWeight: '500',
        color: '#374151',
    },

    chatList: {
        flex: 1,
        paddingHorizontal: 12,
    },
    groupContainer: {
        marginBottom: 20,
    },
    groupTitle: {
        fontSize: 12,
        fontWeight: '600',
        color: '#6b7280',
        paddingHorizontal: 12,
        paddingVertical: 8,
        textTransform: 'uppercase',
    },
    chatItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 16,
        borderRadius: 12,
        marginBottom: 8,
    },
    activeChatItem: {
        backgroundColor: '#e0f2fe',
        borderLeftWidth: 4,
        borderLeftColor: '#0ea5e9',
    },
    chatItemText: {
        fontSize: 18,
        color: '#374151',
        fontWeight: '500',
        flex: 1,
    },
    activeChatItemText: {
        color: '#0369a1',
    },
    footer: {
        padding: 20,
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
    },
    userInfo: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
    },
    userAvatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#a855f7',
        justifyContent: 'center',
        alignItems: 'center',
    },
    userAvatarText: {
        color: '#ffffff',
        fontWeight: 'bold',
        fontSize: 16,
    },
    userName: {
        fontSize: 16,
        color: '#374151',
        fontWeight: '500',
    },
    menuOverlay: {
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.3)',
        justifyContent: 'center',
        alignItems: 'center',
    },
    menuContainer: {
        backgroundColor: '#ffffff',
        borderRadius: 16,
        width: 250,
        padding: 8,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 5,
    },
    menuItem: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 16,
        borderRadius: 12,
    },
    menuItemText: {
        fontSize: 16,
        color: '#374151',
        fontWeight: '500',
    },
    deleteItem: {
        borderTopWidth: 1,
        borderTopColor: '#f3f4f6',
        marginTop: 4,
    },
    deleteText: {
        color: '#ef4444',
    },
    renameContainer: {
        backgroundColor: '#ffffff',
        borderRadius: 16,
        width: 300,
        padding: 20,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 12,
        elevation: 5,
    },
    renameTitle: {
        fontSize: 18,
        fontWeight: 'bold',
        color: '#111827',
        marginBottom: 16,
    },
    renameInput: {
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 8,
        padding: 12,
        fontSize: 16,
        marginBottom: 20,
    },
    renameButtons: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        gap: 12,
    },
    renameButton: {
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 8,
    },
    renameButtonText: {
        fontSize: 16,
        color: '#6b7280',
        fontWeight: '500',
    },
    renameSubmitButton: {
        backgroundColor: '#0ea5e9',
    },
    renameSubmitButtonText: {
        color: '#ffffff',
    }
});
