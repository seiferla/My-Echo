import { Alert, Platform } from 'react-native';

/** Yes/no dialog. Alert.alert does nothing on web, so web uses window.confirm. */
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
