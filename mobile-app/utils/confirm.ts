import { Alert, Platform } from 'react-native';

/**
 * Ja/Nein-Abfrage. Alert.alert gibt es im Web nicht (react-native-web macht
 * daraus nichts), dort window.confirm.
 */
export function confirmAction(
    title: string,
    message: string,
    confirmLabel: string,
    onConfirm: () => void
): void {
    if (Platform.OS === 'web') {
        if (window.confirm(`${title}\n\n${message}`)) onConfirm();
        return;
    }
    Alert.alert(title, message, [
        { text: 'Abbrechen', style: 'cancel' },
        { text: confirmLabel, style: 'destructive', onPress: onConfirm },
    ]);
}
