import React, { useState, useRef, useEffect } from 'react';
import {
    View,
    Text,
    ScrollView,
    TouchableOpacity,
    TextInput,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    Modal,
    SafeAreaView
} from 'react-native';
import { Send, X, Save } from 'lucide-react-native';
import { Message } from './Message';

interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: number;
    via?: 'send' | 'save';
    editCount?: number;
}

interface ChatAreaProps {
    chat?: {
        id: string;
        title: string;
        messages: ChatMessage[];
    };
    onUpdateChat: (messages: ChatMessage[]) => void;
}

export function ChatArea({ chat, onUpdateChat }: ChatAreaProps) {
    const [input, setInput] = useState('');
    const [isTyping] = useState(false);
    const [lastSentIndex, setLastSentIndex] = useState<number | null>(null);
    const [isComposing, setIsComposing] = useState(false);
    const scrollViewRef = useRef<ScrollView>(null);

    const scrollToBottom = () => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
    };

    useEffect(() => {
        scrollToBottom();
    }, [chat?.messages]);

    const handleSend = () => {
        if (!input.trim() || !chat) return;

        const userMessage: ChatMessage = {
            role: 'user',
            content: input,
            timestamp: Date.now(),
            via: 'send',
        };

        const updatedMessages = [...chat.messages, userMessage];
        onUpdateChat(updatedMessages);
        setLastSentIndex(updatedMessages.length - 1);
        setInput('');
        setIsComposing(false);
    };

    const handleSave = () => {
        if (!input.trim() || !chat) return;

        const userMessage: ChatMessage = {
            role: 'user',
            content: input,
            timestamp: Date.now(),
            via: 'save',
        };

        const updatedMessages = [...chat.messages, userMessage];
        onUpdateChat(updatedMessages);
        setLastSentIndex(null); // Set to null to avoid autoPlay
        setInput('');
        setIsComposing(false);
    };

    const handleClose = () => {
        setIsComposing(false);
    };

    return (
        <View style={styles.container}>
            {/* Fullscreen compose overlay (Modal) */}
            <Modal
                visible={isComposing}
                animationType="slide"
                presentationStyle="fullScreen"
            >
                <SafeAreaView style={styles.modalContainer}>
                    <View style={styles.modalHeader}>
                        <TouchableOpacity onPress={handleClose} style={styles.modalButton}>
                            <X size={32} color="#4b5563" />
                        </TouchableOpacity>
                        <View style={{ flexDirection: 'row', gap: 10 }}>
                            <TouchableOpacity
                                onPress={handleSave}
                                disabled={!input.trim()}
                                style={[styles.modalButton, styles.saveButton, !input.trim() && styles.disabledButton]}
                            >
                                <Save size={32} color="white" />
                            </TouchableOpacity>
                            <TouchableOpacity
                                onPress={handleSend}
                                disabled={!input.trim()}
                                style={[styles.modalButton, styles.sendButton, !input.trim() && styles.disabledButton]}
                            >
                                <Send size={32} color="white" />
                            </TouchableOpacity>
                        </View>
                    </View>
                    <TextInput
                        style={styles.modalInput}
                        value={input}
                        onChangeText={setInput}
                        placeholder="Nachricht eingeben..."
                        placeholderTextColor="#9ca3af"
                        multiline
                        autoFocus
                        textAlignVertical="top"
                    />
                </SafeAreaView>
            </Modal>

            {/* Messages list */}
            <ScrollView
                ref={scrollViewRef}
                style={styles.messagesList}
                contentContainerStyle={styles.scrollContent}
                onContentSizeChange={scrollToBottom}
            >
                {chat?.messages.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <Text style={styles.emptyTitle}>myEcho</Text>
                        <Text style={styles.emptySubtitle}>Wie kann ich Ihnen heute helfen?</Text>
                    </View>
                ) : (
                    <View style={styles.messagesWrapper}>
                        {chat?.messages.map((message, index) => (
                            <Message
                                key={index}
                                message={message}
                                autoPlay={index === lastSentIndex && message.role === 'user'}
                                onEdit={
                                    message.role === 'user'
                                        ? (newContent) => {
                                            const updated = chat.messages.map((m, i) =>
                                                i === index
                                                    ? { ...m, content: newContent, editCount: (m.editCount ?? 0) + 1 }
                                                    : m
                                            );
                                            onUpdateChat(updated);
                                        }
                                        : undefined
                                }
                            />
                        ))}
                    </View>
                )}
            </ScrollView>

            {/* Bottom input bar */}
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
            >
                <SafeAreaView style={styles.inputArea}>
                    <View style={styles.inputContainer}>
                        <TouchableOpacity
                            onPress={() => setIsComposing(true)}
                            style={styles.inputFake}
                        >
                            <Text
                                style={[styles.inputFakeText, !input && styles.placeholderText]}
                                numberOfLines={1}
                            >
                                {input || "Nachricht senden..."}
                            </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => input.trim() ? handleSave() : setIsComposing(true)}
                            style={styles.circleSaveButton}
                        >
                            <Save size={24} color="white" />
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => input.trim() ? handleSend() : setIsComposing(true)}
                            style={styles.circleSendButton}
                        >
                            <Send size={24} color="white" />
                        </TouchableOpacity>
                    </View>
                </SafeAreaView>
            </KeyboardAvoidingView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
    },
    modalContainer: {
        flex: 1,
        backgroundColor: '#ffffff',
    },
    modalHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    modalButton: {
        padding: 10,
        borderRadius: 30,
    },
    sendButton: {
        backgroundColor: '#0ea5e9',
    },
    saveButton: {
        backgroundColor: '#10b981',
    },
    disabledButton: {
        opacity: 0.4,
    },
    modalInput: {
        flex: 1,
        padding: 20,
        fontSize: 32,
        color: '#111827',
        fontWeight: '500',
    },
    messagesList: {
        flex: 1,
    },
    scrollContent: {
        flexGrow: 1,
        paddingBottom: 20,
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        paddingVertical: 100,
    },
    emptyTitle: {
        fontSize: 48,
        fontWeight: '600',
        color: '#1f2937',
        marginBottom: 10,
    },
    emptySubtitle: {
        fontSize: 18,
        color: '#4b5563',
    },
    messagesWrapper: {
        width: '100%',
        maxWidth: 600,
        alignSelf: 'center',
    },
    inputArea: {
        borderTopWidth: 1,
        borderTopColor: '#e5e7eb',
        backgroundColor: '#ffffff',
    },
    inputContainer: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 15,
        paddingVertical: 10,
        gap: 12,
    },
    inputFake: {
        flex: 1,
        backgroundColor: '#f9fafb',
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 25,
        paddingHorizontal: 20,
        paddingVertical: 12,
        justifyContent: 'center',
    },
    inputFakeText: {
        fontSize: 18,
        color: '#111827',
    },
    placeholderText: {
        color: '#9ca3af',
    },
    circleSendButton: {
        backgroundColor: '#0ea5e9',
        width: 50,
        height: 50,
        borderRadius: 25,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    },
    circleSaveButton: {
        backgroundColor: '#10b981',
        width: 50,
        height: 50,
        borderRadius: 25,
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 2,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
    }
});
