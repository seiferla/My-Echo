import React from 'react';
import { 
    View, 
    Text, 
    TouchableOpacity, 
    ScrollView, 
    StyleSheet, 
    SafeAreaView,
    Dimensions
} from 'react-native';
import { Plus, MessageSquare, MessageCircle } from 'lucide-react-native';
import { useRouter } from 'expo-router';

const { width } = Dimensions.get('window');

interface Chat {
    id: string;
    title: string;
    messages: any[];
    timestamp: number;
}

interface SidebarProps {
    chats: Chat[];
    currentChatId: string;
    onSelectChat: (id: string) => void;
    onNewChat: () => void;
    onClose: () => void;
}

export function Sidebar({ chats, currentChatId, onSelectChat, onNewChat, onClose }: SidebarProps) {
    const router = useRouter();

    const handleSelectChat = (id: string) => {
        onSelectChat(id);
        onClose();
    };

    const groupChatsByDate = () => {
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;
        const oneWeek = 7 * oneDay;
        const oneMonth = 30 * oneDay;

        const groups: { [key: string]: Chat[] } = {
            'Heute': [],
            'Gestern': [],
            'Letzte 7 Tage': [],
            'Letzte 30 Tage': [],
            'Älter': [],
        };

        chats.forEach(chat => {
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

                <TouchableOpacity
                    onPress={() => {
                        router.push('/phrases');
                        onClose();
                    }}
                    style={styles.phrasesButton}
                >
                    <MessageCircle size={24} color="#0284c7" />
                    <Text style={styles.phrasesText}>Phrasen</Text>
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
                                    style={[
                                        styles.chatItem,
                                        chat.id === currentChatId && styles.activeChatItem
                                    ]}
                                >
                                    <MessageSquare 
                                        size={28} 
                                        color={chat.id === currentChatId ? "#0284c7" : "#4b5563"} 
                                    />
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
                    <Text style={styles.userName}>Benutzer</Text>
                </View>
            </View>
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
    phrasesButton: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        padding: 16,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#38bdf8',
        backgroundColor: '#f0f9ff',
    },
    phrasesText: {
        fontSize: 18,
        fontWeight: '500',
        color: '#0369a1',
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
    }
});
