import React, { useState, useRef, useEffect } from 'react';
import {
    View,
    Text,
    ScrollView,
    ScrollViewInstance,
    TouchableOpacity,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    NativeSyntheticEvent,
    NativeScrollEvent,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Send, X, Save, ChevronDown } from 'lucide-react-native';
import { Message } from './Message';
import { PhraseBar } from './PhraseBar';
import { ComposeModal } from './ComposeModal';
import { usePhrases } from '../context/PhrasesContext';
import { Phrase } from '../utils/phrases';
import { warmBackend } from '../utils/tts';
import { useCloudStatus } from '../context/CloudStatusContext';
import { onTypingChanged, resetTypingPrefetch } from '../utils/typingPrefetch';
import { useFastMode } from '../utils/speedMode';
import { ChatMessage, newMessageId } from '../utils/types';

// Must stay below the backend's WARM_TTL_SECONDS (25 s),
// else the warm TTS connection expires before the next ping.
const WARMUP_INTERVAL_MS = 20_000;

interface ChatAreaProps {
    chat?: {
        id: string;
        title: string;
        messages: ChatMessage[];
    };
    onUpdateChat: (messages: ChatMessage[]) => void;
}

export function ChatArea({ chat, onUpdateChat }: ChatAreaProps) {
    const { visiblePhrases, settings, recordUse } = usePhrases();
    const { isAvailable, voice, model } = useCloudStatus();
    const [fastMode, setFastMode] = useFastMode();
    const [input, setInput] = useState('');
    const [lastSentIndex, setLastSentIndex] = useState<number | null>(null);
    const [isComposing, setIsComposing] = useState(false);
    // When editingIndex !== null, the modal is in edit mode (Check + X instead of Save + Send).
    const [editingIndex, setEditingIndex] = useState<number | null>(null);
    const [editInput, setEditInput] = useState('');
    const scrollViewRef = useRef<ScrollViewInstance>(null);
    const insets = useSafeAreaInsets();
    // true when the user is near the end of the list.
    // Starts true: the arrow is hidden and auto-scroll is on.
    const [isNearBottom, setIsNearBottom] = useState(true);

    // Empty chat: phrases as tiles in the middle.
    // With messages: a small row above the input.
    const showStrip = (chat?.messages.length ?? 0) > 0 && visiblePhrases.length > 0;

    const isEditMode = editingIndex !== null;
    const isModalOpen = isComposing || isEditMode;
    const modalValue = isEditMode ? editInput : input;
    const setModalValue = isEditMode ? setEditInput : setInput;

    const scrollToBottom = () => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
    };

    // Checks the distance to the end of the list. 150 px is about half a bubble,
    // so small movements at the end do not show the arrow.
    const handleScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
        const { layoutMeasurement, contentOffset, contentSize } = e.nativeEvent;
        const distanceFromBottom =
            contentSize.height - layoutMeasurement.height - contentOffset.y;
        setIsNearBottom(distanceFromBottom < 150);
    };

    // Opens the editor. The effect below keeps the backend connection warm meanwhile.
    const openCompose = () => {
        setIsComposing(true);
    };

    useEffect(() => {
        scrollToBottom();
    }, [chat?.messages]);

    // Keeps the TTS connection warm while the editor is open. Users often type
    // longer than the backend TTL (25 s), so one warmup call is not enough.
    useEffect(() => {
        if (!isComposing) return;

        warmBackend();
        const interval = setInterval(() => {
            warmBackend();
        }, WARMUP_INTERVAL_MS);

        return () => clearInterval(interval);
    }, [isComposing]);

    // Sentence prefetch (fast mode): while typing, synthesize finished sentences
    // (and the rest after a 1 s pause) in the background. Off in eco mode and
    // when editing (an edit is only saved, not spoken).
    useEffect(() => {
        if (!isComposing || isEditMode || !isAvailable || !fastMode) {
            resetTypingPrefetch();
            return;
        }
        onTypingChanged(input, voice, model);
    }, [input, isComposing, isEditMode, isAvailable, fastMode, voice, model]);

    // Reset autoPlay on chat change, else the message at the same index of the
    // other chat would be spoken.
    useEffect(() => {
        setLastSentIndex(null);
    }, [chat?.id]);

    // Shared path for send (spoken) and save (silent). Takes the text as a
    // parameter, so a phrase can be sent without going through the input.
    const appendMessage = (text: string, via: 'send' | 'save') => {
        const content = text.trim();
        if (!content || !chat) return;

        const userMessage: ChatMessage = {
            id: newMessageId(),
            role: 'user',
            content,
            timestamp: Date.now(),
            via,
        };

        const updatedMessages = [...chat.messages, userMessage];
        onUpdateChat(updatedMessages);
        // Speak only on send: autoPlay uses the index of the new message.
        setLastSentIndex(via === 'send' ? updatedMessages.length - 1 : null);
        setInput('');
        setIsComposing(false);
    };

    const handleSend = () => appendMessage(input, 'send');
    const handleSave = () => appendMessage(input, 'save');

    // Tap on a phrase. One setting for all phrases (on the phrases screen):
    //   on  → send and speak at once (fastest answer, e.g. "Ja")
    //   off → append the text to the input, so sentences can be built from parts.
    const handlePhrase = (phrase: Phrase) => {
        recordUse(phrase.id);
        if (settings.instantEnabled) {
            appendMessage(phrase.text, 'send');
            return;
        }
        setInput((prev) => (prev.trim() ? `${prev.trim()} ${phrase.text}` : phrase.text));
    };

    const handleClose = () => {
        setIsComposing(false);
    };

    // Edit-Flow ---------------------------------------------------------------
    const handleStartEdit = (index: number, content: string) => {
        setEditingIndex(index);
        setEditInput(content);
    };

    const handleSaveEdit = () => {
        if (!editInput.trim() || !chat || editingIndex === null) return;
        const updated = chat.messages.map((m, i) =>
            i === editingIndex
                ? { ...m, content: editInput.trim(), editCount: (m.editCount ?? 0) + 1 }
                : m
        );
        onUpdateChat(updated);
        setEditingIndex(null);
        setEditInput('');
    };

    const handleCancelEdit = () => {
        setEditingIndex(null);
        setEditInput('');
    };

    // Closes whatever modal is currently open (compose or edit).
    const handleCloseModal = () => {
        if (isEditMode) handleCancelEdit();
        else handleClose();
    };

    return (
        <View style={styles.container}>
            {/* Full-screen editor, for new messages AND for editing */}
            <ComposeModal
                visible={isModalOpen}
                isEditMode={isEditMode}
                value={modalValue}
                onChangeText={setModalValue}
                fastMode={fastMode}
                onToggleFastMode={() => setFastMode(!fastMode)}
                onClose={handleCloseModal}
                onSave={handleSave}
                onSend={handleSend}
                onSaveEdit={handleSaveEdit}
            />

            {/* Messages list */}
            <ScrollView
                ref={scrollViewRef}
                style={styles.messagesList}
                contentContainerStyle={styles.scrollContent}
                onContentSizeChange={() => {
                    // Auto-scroll only when the user is already at the end,
                    // so reading old messages is not interrupted.
                    if (isNearBottom) scrollToBottom();
                }}
                onScroll={handleScroll}
                scrollEventThrottle={16}
            >
                {chat?.messages.length === 0 ? (
                    <View style={styles.emptyContainer}>
                        <Text style={styles.emptyTitle}>myEcho</Text>
                        <Text style={styles.emptySubtitle}>Wie kann ich Ihnen heute helfen?</Text>
                        {/* Empty chat has space: phrases as big tiles in the middle,
                            ready at app start. */}
                        <PhraseBar
                            phrases={visiblePhrases}
                            variant="grid"
                            speaksInstantly={settings.instantEnabled}
                            onSelect={handlePhrase}
                        />
                    </View>
                ) : (
                    <View style={styles.messagesWrapper}>
                        {chat?.messages.map((message, index) => (
                            <Message
                                key={message.id}
                                message={message}
                                autoPlay={index === lastSentIndex && message.role === 'user'}
                                onStartEdit={
                                    message.role === 'user'
                                        ? () => handleStartEdit(index, message.content)
                                        : undefined
                                }
                            />
                        ))}
                    </View>
                )}
            </ScrollView>

            {/* Floating "to newest message" arrow, only when the user scrolled up.
                Sits just above the input bar. */}
            {!isNearBottom && (
                <TouchableOpacity
                    onPress={scrollToBottom}
                    style={[styles.scrollDownButton, showStrip && styles.scrollDownButtonRaised]}
                    accessibilityRole="button"
                    accessibilityLabel="Zur neuesten Nachricht"
                >
                    <ChevronDown size={24} color="#374151" />
                </TouchableOpacity>
            )}

            {/* Bottom input bar: paddingBottom on the container, no extra SafeAreaView */}
            <KeyboardAvoidingView
                behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
            >
                <View style={styles.inputArea}>
                    {/* Chat with messages: phrases as a small row above the input,
                        where the thumb already is. */}
                    {showStrip && (
                        <PhraseBar
                            phrases={visiblePhrases}
                            variant="strip"
                            speaksInstantly={settings.instantEnabled}
                            onSelect={handlePhrase}
                        />
                    )}
                    <View style={[styles.inputContainer, { paddingBottom: insets.bottom + 10 }]}>
                        <TouchableOpacity
                            onPress={openCompose}
                            style={styles.inputFake}
                        >
                            <Text
                                style={[styles.inputFakeText, !input && styles.placeholderText]}
                                numberOfLines={1}
                            >
                                {input || "Nachricht senden..."}
                            </Text>
                            {/* Phrases can fill the field without opening the editor,
                                so it needs a clear button here. */}
                            {!!input && (
                                <TouchableOpacity
                                    onPress={() => setInput('')}
                                    style={styles.clearButton}
                                    accessibilityLabel="Eingabe löschen"
                                    hitSlop={8}
                                >
                                    <X size={18} color="#9ca3af" />
                                </TouchableOpacity>
                            )}
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => input.trim() ? handleSave() : openCompose()}
                            style={styles.circleSaveButton}
                        >
                            <Save size={24} color="white" />
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => input.trim() ? handleSend() : openCompose()}
                            style={styles.circleSendButton}
                        >
                            <Send size={24} color="white" />
                        </TouchableOpacity>
                    </View>
                </View>
            </KeyboardAvoidingView>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: '#ffffff',
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
        paddingTop: 10,
        gap: 12,
    },
    inputFake: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        backgroundColor: '#f9fafb',
        borderWidth: 1,
        borderColor: '#d1d5db',
        borderRadius: 25,
        paddingLeft: 20,
        paddingRight: 12,
        paddingVertical: 12,
    },
    inputFakeText: {
        flex: 1,
        fontSize: 18,
        color: '#111827',
    },
    clearButton: {
        padding: 4,
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
    },
    scrollDownButton: {
        position: 'absolute',
        // Just above the input bar (~90 px high with padding).
        bottom: 90,
        alignSelf: 'center',
        backgroundColor: '#ffffff',
        width: 44,
        height: 44,
        borderRadius: 22,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#e5e7eb',
        // Lifts the button visually off the list.
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.15,
        shadowRadius: 6,
    },
    // With the phrase row the input bar is higher, so the arrow moves up too.
    scrollDownButtonRaised: {
        bottom: 140,
    },
});