import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    Pressable,
    StyleSheet,
    Alert,
} from 'react-native';
import { Bot, Volume2, Pause, Pencil } from 'lucide-react-native';
import { speak, stopSpeaking } from '../utils/tts';
import { copyMessage, shareMessageAudio, shareMessageText } from '../utils/messageShare';
import { useCloudStatus } from '../context/CloudStatusContext';
import { recordTtsRequest } from '../utils/ttsLog';

interface MessageProps {
    message: {
        role: 'user' | 'assistant';
        content: string;
    };
    // Editing happens in a fullscreen modal owned by ChatArea — see handleStartEdit there.
    onStartEdit?: () => void;
    autoPlay?: boolean;
}

export function Message({ message, onStartEdit, autoPlay }: MessageProps) {
    const isUser = message.role === 'user';
    const { isAvailable, voice, model } = useCloudStatus();
    const [isPlaying, setIsPlaying] = useState(false);
    const isPreparingShareRef = useRef(false);
    const speakStartRef = useRef<number | null>(null);

    // Records a finished speech output exactly once.
    const logSpeak = () => {
        if (speakStartRef.current === null) return;
        const durationMs = Date.now() - speakStartRef.current;
        speakStartRef.current = null;
        recordTtsRequest(message.content.length, durationMs).catch(() => {});
    };

    useEffect(() => {
        if (autoPlay && isUser) {
            handleSpeak();
        }
        return () => {
            stopSpeaking();
        };
    }, []);

    // Only one audio share at a time: preparing the file can take a moment.
    const shareAudio = async () => {
        if (isPreparingShareRef.current) return;
        if (!isAvailable) {
            Alert.alert('Nicht verfügbar', 'Sprachnachricht kann nur geteilt werden, wenn die Cloud-Sprachausgabe erreichbar ist.');
            return;
        }

        isPreparingShareRef.current = true;
        try {
            await shareMessageAudio(message.content, voice, model);
        } finally {
            isPreparingShareRef.current = false;
        }
    };

    const handleShare = () => {
        Alert.alert('Teilen als', undefined, [
            { text: 'Text', onPress: () => shareMessageText(message.content) },
            { text: 'Sprachnachricht', onPress: shareAudio },
            { text: 'Abbrechen', style: 'cancel' },
        ]);
    };

    const handleLongPress = () => {
        Alert.alert('Nachricht', undefined, [
            { text: 'Kopieren', onPress: () => copyMessage(message.content) },
            { text: 'Teilen', onPress: handleShare },
            { text: 'Abbrechen', style: 'cancel' },
        ]);
    };

    const handleSpeak = async () => {
        if (isPlaying) {
            stopSpeaking();
            setIsPlaying(false);
            return;
        }

        setIsPlaying(true);
        speakStartRef.current = Date.now();

        try {
            await speak(message.content, isAvailable, voice, model);
            logSpeak();
        } catch {
            speakStartRef.current = null;
        } finally {
            setIsPlaying(false);
        }
    };

    return (
        <View style={[
            styles.container,
            isUser ? styles.userContainer : styles.assistantContainer
        ]}>
            {!isUser && (
                <View style={styles.avatar}>
                    <Bot size={24} color="#60a5fa" />
                </View>
            )}

            <Pressable
                onLongPress={handleLongPress}
                delayLongPress={400}
                style={({ pressed }) => [
                    styles.bubble,
                    isUser ? styles.userBubble : styles.assistantBubble,
                    pressed && styles.bubblePressed,
                ]}
                accessibilityRole="text"
                accessibilityHint="Lang drücken zum Kopieren oder Teilen"
            >
                <Text style={[
                    styles.text,
                    isUser ? styles.userText : styles.assistantText
                ]}>
                    {message.content}
                </Text>

                <View style={styles.footerActions}>
                    <TouchableOpacity onPress={handleSpeak} style={styles.iconButton}>
                        {isPlaying ? <Pause size={20} color="#000000" /> : <Volume2 size={20} color="#000000" />}
                    </TouchableOpacity>
                    {isUser && onStartEdit && (
                        <TouchableOpacity onPress={onStartEdit} style={styles.iconButton}>
                            <Pencil size={20} color="#000000" />
                        </TouchableOpacity>
                    )}
                </View>
            </Pressable>
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flexDirection: 'row',
        marginVertical: 10,
        paddingHorizontal: 15,
        alignItems: 'flex-end',
    },
    userContainer: {
        justifyContent: 'flex-end',
    },
    assistantContainer: {
        justifyContent: 'flex-start',
    },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: 20,
        backgroundColor: '#f1f5f9',
        justifyContent: 'center',
        alignItems: 'center',
        marginRight: 10,
    },
    bubble: {
        maxWidth: '80%',
        padding: 15,
        borderRadius: 20,
    },
    bubblePressed: {
        opacity: 0.85,
    },
    userBubble: {
        backgroundColor: '#60a5fa',
        borderBottomRightRadius: 4,
    },
    assistantBubble: {
        backgroundColor: '#f1f5f9',
        borderBottomLeftRadius: 4,
    },
    text: {
        fontSize: 18,
        lineHeight: 24,
    },
    userText: {
        color: '#ffffff',
    },
    assistantText: {
        color: '#1e293b',
    },
    footerActions: {
        flexDirection: 'row',
        marginTop: 8,
        opacity: 0.6,
    },
    iconButton: {
        marginRight: 15,
        padding: 5,
    }
});
