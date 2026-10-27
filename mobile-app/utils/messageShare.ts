import { Alert, Platform, Share, ToastAndroid, Vibration } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import * as Sharing from 'expo-sharing';
import { getShareableAudioUri } from './tts';

// Copy and share actions of a chat message. They show their own feedback (toast or alert).

/** Copies the text. Short vibration plus a toast (Android) or alert (iOS). Clipboard errors are ignored. */
export async function copyMessage(text: string): Promise<void> {
    try {
        await Clipboard.setStringAsync(text);
        Vibration.vibrate(40);
        if (Platform.OS === 'android') {
            ToastAndroid.show('In Zwischenablage kopiert', ToastAndroid.SHORT);
        } else {
            Alert.alert('Kopiert', 'Text in die Zwischenablage übernommen.');
        }
    } catch {
        // No error dialog: the user sees no feedback and can try again.
    }
}

/** Shares the text with the native share sheet (WhatsApp is one option there). */
export async function shareMessageText(text: string): Promise<void> {
    try {
        await Share.share({ message: text });
    } catch {
        // Cancelled by the user or platform error: no feedback needed.
    }
}

/**
 * Shares the spoken version as an audio file. Needs cloud TTS (expo-speech makes
 * no file). On a cache miss it downloads first, which can take a moment.
 */
export async function shareMessageAudio(text: string, voice: string, model: string): Promise<void> {
    try {
        const uri = await getShareableAudioUri(text, true, voice, model);
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
    }
}
