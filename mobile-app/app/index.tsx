import React, { useState } from 'react';
import {
    View,
    StyleSheet,
    TouchableOpacity,
    Text,
    Modal,
    Dimensions,
    TouchableWithoutFeedback
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Menu, PenSquare } from 'lucide-react-native';
import { Sidebar } from '../components/Sidebar';
import { ChatArea } from '../components/ChatArea';
import { useCloudStatus } from '../context/CloudStatusContext';
import { useChats } from '../hooks/useChats';

const { width } = Dimensions.get('window');

export default function ChatScreen() {
    const insets = useSafeAreaInsets();
    const { isAvailable } = useCloudStatus();
    const [isSidebarOpen, setIsSidebarOpen] = useState(false);
    const {
        chats,
        currentChat,
        currentChatId,
        selectChat: openChat,
        createChat,
        pinChat,
        renameChat,
        deleteChat,
        updateChat,
    } = useChats();

    const toggleSidebar = () => setIsSidebarOpen(!isSidebarOpen);

    const createNewChat = () => {
        createChat();
        setIsSidebarOpen(false);
    };

    const selectChat = (id: string) => {
        openChat(id);
        setIsSidebarOpen(false);
    };

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
                    <View style={styles.sidebarWrapper}>
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
                    </View>
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
