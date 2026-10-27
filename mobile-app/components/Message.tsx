import React, { useState, useEffect, useRef } from 'react';
import {
    View,
    Text,
    TouchableOpacity,
    Pressable,
    StyleSheet,
    Platform,
    ToastAndroid,
    Alert,
    Vibration,
    Share,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { Bot, Volume2, Pause, Pencil } from 'lucide-react-native';
import { speak, stopSpeaking, getShareableAudioUri } from '../utils/tts';
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

    // Copies the message text. Short vibration plus a toast (Android) or alert (iOS)
    // as feedback. Clipboard errors are ignored.
    const handleCopy = async () => {
        try {
            await Clipboard.setStringAsync(message.content);
            Vibration.vibrate(40);
            if (Platform.OS === 'android') {
                ToastAndroid.show('In Zwischenablage kopiert', ToastAndroid.SHORT);
            } else {
                Alert.alert('Kopiert', 'Text in die Zwischenablage übernommen.');
            }
        } catch {
            // No error dialog: the user sees no feedback and can try again.
        }
    };

    // Shares the text with the native share sheet (WhatsApp is one option there).
    const shareText = async () => {
        try {
            await Share.share({ message: message.content });
        } catch {
            // Cancelled by the user or platform error: no feedback needed.
        }
    };

    // Shares the spoken version as an audio file. Needs cloud TTS (expo-speech makes
    // no file). On a cache miss it downloads first, which can take a moment.
    const shareAudio = async () => {
        if (isPreparingShareRef.current) return;
        if (!isAvailable) {
            Alert.alert('Nicht verfügbar', 'Sprachnachricht kann nur geteilt werden, wenn die Cloud-Sprachausgabe erreichbar ist.');
            return;
        }

        isPreparingShareRef.current = true;
        try {
            const uri = await getShareableAudioUri(message.content, isAvailable, voice, model);
            if (!uri) {
                Alert.alert('Fehler', 'Sprachnachricht konnte nicht vorbereitet werden.');
                return;
            }
            if (!(await Sharing.isAvailableAsync())) {
                Alert.alert('Nicht unterstützt', 'Teilen wird auf diesem Gerät nicht unterstützt.');
                return;
            }
            await Sharing.shareAsync(uri, {
                mimeType: 'audio/mpeg',
                dialogTitle: 'Sprachnachricht teilen',
            });
        } catch {
            Alert.alert('Fehler', 'Sprachnachricht konnte nicht geteilt werden.');
        } finally {
            isPreparingShareRef.current = false;
        }
    };

    const handleShare = () => {
        Alert.alert('Teilen als', undefined, [
            { text: 'Text', onPress: shareText },
            { text: 'Sprachnachricht', onPress: shareAudio },
            { text: 'Abbrechen', style: 'cancel' },
        ]);
    };

    const handleLongPress = () => {
        Alert.alert('Nachricht', undefined, [
            { text: 'Kopieren', onPress: handleCopy },
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
