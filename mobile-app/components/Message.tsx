import React, { useState, useEffect } from 'react';
import { View, Text, TouchableOpacity, TextInput, StyleSheet } from 'react-native';
import { Bot, Volume2, Pause, Pencil, Check, X } from 'lucide-react-native';
import * as Speech from 'expo-speech';

interface MessageProps {
    message: {
        role: 'user' | 'assistant';
        content: string;
    };
    isTyping?: boolean;
    onEdit?: (newContent: string) => void;
    autoPlay?: boolean;
}

export function Message({ message, isTyping, onEdit, autoPlay }: MessageProps) {
    const isUser = message.role === 'user';
    const [isPlaying, setIsPlaying] = useState(false);
    const [isEditing, setIsEditing] = useState(false);
    const [editText, setEditText] = useState(message.content);

    useEffect(() => {
        if (autoPlay && isUser) {
            handleSpeak();
        }
        return () => {
            Speech.stop();
        };
    }, []);

    const handleSpeak = async () => {
        const speaking = await Speech.isSpeakingAsync();
        if (speaking || isPlaying) {
            Speech.stop();
            setIsPlaying(false);
            if (!isPlaying) return; // If we were just stopping another speech
        }

        setIsPlaying(true);
        Speech.speak(message.content, {
            language: 'de-DE',
            onDone: () => setIsPlaying(false),
            onError: () => setIsPlaying(false),
        });
    };

    const handleEditSave = () => {
        if (editText.trim() && onEdit) {
            onEdit(editText.trim());
        }
        setIsEditing(false);
    };

    return (
        <View style={[
            styles.container,
            isUser ? styles.userContainer : styles.assistantContainer
        ]}>
            {!isUser && (
                <View style={styles.avatar}>
                    <Bot size={24} color="#6366f1" />
                </View>
            )}

            <View style={[
                styles.bubble,
                isUser ? styles.userBubble : styles.assistantBubble
            ]}>
                {isEditing ? (
                    <View>
                        <TextInput
                            style={styles.input}
                            value={editText}
                            onChangeText={setEditText}
                            multiline
                            autoFocus
                        />
                        <View style={styles.editActions}>
                            <TouchableOpacity onPress={handleEditSave} style={styles.actionButton}>
                                <Check size={20} color="green" />
                            </TouchableOpacity>
                            <TouchableOpacity onPress={() => setIsEditing(false)} style={styles.actionButton}>
                                <X size={20} color="red" />
                            </TouchableOpacity>
                        </View>
                    </View>
                ) : (
                    <Text style={[
                        styles.text,
                        isUser ? styles.userText : styles.assistantText
                    ]}>
                        {message.content}
                    </Text>
                )}

                {!isEditing && (
                    <View style={styles.footerActions}>
                        <TouchableOpacity onPress={handleSpeak} style={styles.iconButton}>
                            {isPlaying ? <Pause size={20} color="#94a3b8" /> : <Volume2 size={20} color="#94a3b8" />}
                        </TouchableOpacity>
                        {isUser && (
                            <TouchableOpacity onPress={() => setIsEditing(true)} style={styles.iconButton}>
                                <Pencil size={20} color="#94a3b8" />
                            </TouchableOpacity>
                        )}
                    </View>
                )}
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
        backgroundColor: '#6366f1',
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
    input: {
        fontSize: 18,
        color: '#ffffff',
        minWidth: 200,
    },
    editActions: {
        flexDirection: 'row',
        justifyContent: 'flex-end',
        marginTop: 10,
    },
    footerActions: {
        flexDirection: 'row',
        marginTop: 8,
        opacity: 0.6,
    },
    actionButton: {
        marginLeft: 15,
        padding: 5,
    },
    iconButton: {
        marginRight: 15,
        padding: 5,
    }
});
