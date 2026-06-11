import React, { useState, useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Bot, Volume2, Pause, Pencil } from 'lucide-react-native';
import { speak, stopSpeaking } from '../utils/tts';
import { useCloudStatus } from '../context/CloudStatusContext';
import { recordTtsRequest } from '../utils/ttsLog';

interface MessageProps {
    message: {
        role: 'user' | 'assistant';
        content: string;
    };
    isTyping?: boolean;
    // Editing happens in a fullscreen modal owned by ChatArea — see handleStartEdit there.
    onStartEdit?: () => void;
    autoPlay?: boolean;
}

export function Message({ message, isTyping, onStartEdit, autoPlay }: MessageProps) {
    const isUser = message.role === 'user';
    const { isAvailable, voice, model } = useCloudStatus();
    const [isPlaying, setIsPlaying] = useState(false);
    const speakStartRef = useRef<number | null>(null);

    // Protokolliert eine abgeschlossene Sprachausgabe genau einmal.
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

            <View style={[
                styles.bubble,
                isUser ? styles.userBubble : styles.assistantBubble
            ]}>
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
            </View>
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
