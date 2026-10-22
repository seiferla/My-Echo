import React, { useRef, useState } from 'react';
import {
    View,
    Text,
    Image,
    TextInput,
    TouchableOpacity,
    ScrollView,
    StyleSheet,
    KeyboardAvoidingView,
    Platform,
    ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Eye, EyeOff } from 'lucide-react-native';
import { useAuth } from '../context/AuthContext';

// Anmeldung nur mit E-Mail + Passwort. Kein Registrieren, kein CAPTCHA, kein
// Zeitlimit — Konten legt der Admin an. Einfügen und Autofill (Passwort-
// Manager) sind ausdrücklich erlaubt. Große Felder und feste Beschriftungen,
// damit TalkBack alles vorliest.
export default function LoginScreen() {
    const { signIn } = useAuth();
    const passwordRef = useRef<React.ComponentRef<typeof TextInput>>(null);
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const canSubmit = email.trim().length > 0 && password.length > 0 && !busy;

    const submit = async () => {
        if (!canSubmit) return;
        setBusy(true);
        setError(null);
        const message = await signIn(email, password);
        // Bei Erfolg wechselt der Route-Guard in _layout.tsx von selbst zu den Chats.
        if (message) setError(message);
        setBusy(false);
    };

    return (
        <SafeAreaView style={styles.container}>
            {/* Helle Statusleiste-Schrift, weil der Hintergrund jetzt dunkel ist. */}
            <StatusBar style="light" />
            <KeyboardAvoidingView
                style={styles.flex}
                behavior={Platform.OS === 'ios' ? 'padding' : undefined}
            >
                <ScrollView
                    contentContainerStyle={styles.content}
                    keyboardShouldPersistTaps="handled"
                >
                    {/* Logo ist dekorativ: der Titel darunter sagt schon "myEcho". */}
                    <Image
                        source={require('../assets/login-logo.png')}
                        style={styles.logo}
                        accessible={false}
                        importantForAccessibility="no"
                    />
                    <Text style={styles.title} accessibilityRole="header">myEcho</Text>
                    <Text style={styles.subtitle}>Mit deinem Konto anmelden</Text>

                    <View style={styles.card}>
                        <Text style={styles.label}>E-Mail</Text>
                        <TextInput
                            style={styles.input}
                            value={email}
                            onChangeText={setEmail}
                            accessibilityLabel="E-Mail"
                            placeholder="name@beispiel.de"
                            placeholderTextColor="#6b7280"
                            keyboardType="email-address"
                            autoCapitalize="none"
                            autoCorrect={false}
                            autoComplete="email"
                            textContentType="username"
                            returnKeyType="next"
                            onSubmitEditing={() => passwordRef.current?.focus()}
                            editable={!busy}
                        />

                        <Text style={[styles.label, styles.labelSpaced]}>Passwort</Text>
                        <View style={styles.passwordRow}>
                            <TextInput
                                ref={passwordRef}
                                style={[styles.input, styles.passwordInput]}
                                value={password}
                                onChangeText={setPassword}
                                accessibilityLabel="Passwort"
                                placeholder="Passwort"
                                placeholderTextColor="#6b7280"
                                secureTextEntry={!showPassword}
                                autoCapitalize="none"
                                autoCorrect={false}
                                autoComplete="current-password"
                                textContentType="password"
                                returnKeyType="go"
                                onSubmitEditing={submit}
                                editable={!busy}
                            />
                            <TouchableOpacity
                                style={styles.eyeButton}
                                onPress={() => setShowPassword((v) => !v)}
                                accessibilityRole="button"
                                accessibilityLabel={showPassword ? 'Passwort verbergen' : 'Passwort anzeigen'}
                            >
                                {showPassword
                                    ? <EyeOff size={26} color="#374151" />
                                    : <Eye size={26} color="#374151" />}
                            </TouchableOpacity>
                        </View>

                        {error && (
                            <View
                                style={styles.errorBox}
                                accessibilityRole="alert"
                                accessibilityLiveRegion="polite"
                            >
                                <Text style={styles.errorText}>Fehler: {error}</Text>
                            </View>
                        )}

                        <TouchableOpacity
                            style={[styles.button, !canSubmit && styles.buttonDisabled]}
                            onPress={submit}
                            disabled={!canSubmit}
                            accessibilityRole="button"
                            accessibilityLabel="Anmelden"
                            accessibilityState={{ disabled: !canSubmit, busy }}
                        >
                            {busy
                                ? <ActivityIndicator color="#ffffff" />
                                : <Text style={styles.buttonText}>Anmelden</Text>}
                        </TouchableOpacity>
                    </View>

                    <Text style={styles.hint}>
                        Noch kein Konto? Dein Konto wird für dich angelegt. Bitte melde dich beim Administrator.
                    </Text>
                </ScrollView>
            </KeyboardAvoidingView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    flex: { flex: 1 },
    // Farben aus dem Logo: dunkles Navy + Gold. Gold nur auf Navy (auf Weiß zu blass).
    container: { flex: 1, backgroundColor: '#14284a' },
    content: { flexGrow: 1, justifyContent: 'center', padding: 24 },

    logo: { width: 120, height: 120, alignSelf: 'center', marginBottom: 16 },
    title: { fontSize: 36, fontWeight: 'bold', color: '#f2c94c', textAlign: 'center' },
    subtitle: { fontSize: 18, color: '#e2e8f0', textAlign: 'center', marginTop: 8, marginBottom: 28 },

    card: {
        backgroundColor: '#ffffff',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        padding: 20,
    },
    label: { fontSize: 18, fontWeight: '600', color: '#111827', marginBottom: 8 },
    labelSpaced: { marginTop: 20 },
    input: {
        minHeight: 56,
        borderWidth: 2,
        borderColor: '#9ca3af',
        borderRadius: 12,
        paddingHorizontal: 14,
        fontSize: 18,
        color: '#111827',
        backgroundColor: '#ffffff',
    },
    passwordRow: { flexDirection: 'row', alignItems: 'center' },
    passwordInput: { flex: 1 },
    eyeButton: {
        minWidth: 56,
        minHeight: 56,
        alignItems: 'center',
        justifyContent: 'center',
        marginLeft: 8,
    },

    errorBox: {
        marginTop: 20,
        padding: 14,
        borderRadius: 12,
        borderWidth: 2,
        borderColor: '#b91c1c',
        backgroundColor: '#fef2f2',
    },
    errorText: { fontSize: 18, color: '#7f1d1d', fontWeight: '600' },

    // Navy aus dem Logo: weißer Text hat ca. 11:1 Kontrast (WCAG AAA).
    button: {
        minHeight: 60,
        marginTop: 24,
        borderRadius: 14,
        backgroundColor: '#1e3a5f',
        alignItems: 'center',
        justifyContent: 'center',
    },
    buttonDisabled: { backgroundColor: '#6b7280' },
    buttonText: { fontSize: 20, fontWeight: 'bold', color: '#ffffff' },

    hint: { fontSize: 16, color: '#e2e8f0', textAlign: 'center', marginTop: 24, lineHeight: 23 },
});
