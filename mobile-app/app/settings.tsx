import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Mic, BarChart3, Mail, LogOut, Trash2 } from 'lucide-react-native';
import type { LucideIcon } from 'lucide-react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { useAuth } from '../context/AuthContext';
import { confirmAction } from '../utils/confirm';
import { fetchVoice } from '../utils/voice';

interface RowProps {
    icon: LucideIcon;
    label: string;
    subtitle?: string;
    onPress: () => void;
    isLast?: boolean;
}

/** One full-width row with a big touch target and a visible text label. */
function SettingsRow({ icon: Icon, label, subtitle, onPress, isLast }: RowProps) {
    return (
        <TouchableOpacity
            onPress={onPress}
            style={[styles.row, !isLast && styles.rowDivider]}
            accessibilityRole="button"
            accessibilityLabel={subtitle ? `${label}, ${subtitle}` : label}
        >
            <Icon size={24} color="#0284c7" />
            <View style={styles.rowText}>
                <Text style={styles.rowLabel}>{label}</Text>
                {subtitle ? <Text style={styles.rowSubtitle}>{subtitle}</Text> : null}
            </View>
            <ChevronRight size={22} color="#9ca3af" />
        </TouchableOpacity>
    );
}

export default function SettingsScreen() {
    const router = useRouter();
    const { session, signOut, deleteAccount } = useAuth();
    const email = session?.user.email ?? '';
    // undefined = not known yet (loading or offline), so we show no status at all.
    const [hasVoice, setHasVoice] = useState<boolean | undefined>(undefined);

    useFocusEffect(
        useCallback(() => {
            fetchVoice()
                .then((voice) => setHasVoice(voice !== null))
                .catch(() => setHasVoice(undefined));
        }, [])
    );

    const voiceStatus =
        hasVoice === undefined ? undefined : hasVoice ? 'Eigene Stimme aktiv' : 'Standardstimme';

    const handleLogout = () => {
        confirmAction(
            'Abmelden',
            'Deine Chats bleiben gespeichert. Beim nächsten Anmelden sind sie wieder da.',
            'Abmelden',
            () => { void signOut(); }
        );
    };

    const handleDeleteAccount = () => {
        confirmAction(
            'Konto löschen',
            'Dein Konto und alle Daten werden endgültig gelöscht. Deine geklonte Stimme wird ebenfalls entfernt. Das kann nicht rückgängig gemacht werden.',
            'Konto löschen',
            () => {
                void deleteAccount().then((error) => {
                    if (error) Alert.alert('Konto löschen fehlgeschlagen', error);
                });
            }
        );
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity
                    onPress={() => router.back()}
                    style={styles.backButton}
                    accessibilityRole="button"
                    accessibilityLabel="Zurück"
                >
                    <ChevronLeft size={28} color="#374151" />
                </TouchableOpacity>
                <Text style={styles.headerTitle} accessibilityRole="header">Einstellungen</Text>
                <View style={styles.backButton} />
            </View>

            <ScrollView contentContainerStyle={styles.scroll}>
                <Text style={styles.sectionTitle} accessibilityRole="header">Sprechen</Text>
                <View style={styles.card}>
                    <SettingsRow
                        icon={Mic}
                        label="Meine Stimme"
                        subtitle={voiceStatus}
                        onPress={() => router.push('/voice')}
                    />
                    <SettingsRow
                        icon={BarChart3}
                        label="Statistik"
                        onPress={() => router.push('/stats')}
                        isLast
                    />
                </View>

                <Text style={styles.sectionTitle} accessibilityRole="header">Konto</Text>
                <View style={styles.card}>
                    <View style={[styles.row, styles.rowDivider]} accessible accessibilityLabel={`Angemeldet als ${email}`}>
                        <Mail size={24} color="#6b7280" />
                        <Text style={styles.emailText} numberOfLines={1}>{email}</Text>
                    </View>
                    <TouchableOpacity
                        onPress={handleLogout}
                        style={styles.row}
                        accessibilityRole="button"
                        accessibilityLabel="Abmelden"
                    >
                        <LogOut size={24} color="#374151" />
                        <Text style={styles.rowLabel}>Abmelden</Text>
                    </TouchableOpacity>
                </View>

                {/* Kept far away from everything else, so it is never tapped by mistake. */}
                <TouchableOpacity
                    onPress={handleDeleteAccount}
                    style={styles.deleteButton}
                    accessibilityRole="button"
                    accessibilityLabel="Konto löschen"
                    accessibilityHint="Löscht dein Konto und alle Daten endgültig"
                >
                    <Trash2 size={22} color="#dc2626" />
                    <Text style={styles.deleteText}>Konto löschen</Text>
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
}

const styles = StyleSheet.create({
    container: { flex: 1, backgroundColor: '#f8fafc' },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        paddingHorizontal: 8,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
        backgroundColor: '#ffffff',
    },
    // 56 pt touch target for the back button.
    backButton: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
    headerTitle: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: 'bold', color: '#111827' },

    scroll: { padding: 16, paddingBottom: 40 },
    sectionTitle: {
        fontSize: 14,
        fontWeight: '600',
        color: '#6b7280',
        marginTop: 16,
        marginBottom: 8,
        marginHorizontal: 4,
    },
    card: {
        backgroundColor: '#ffffff',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e5e7eb',
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        minHeight: 64,
        paddingHorizontal: 16,
        paddingVertical: 12,
    },
    rowDivider: { borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
    rowText: { flex: 1 },
    rowLabel: { fontSize: 18, fontWeight: '500', color: '#111827' },
    rowSubtitle: { fontSize: 14, color: '#6b7280', marginTop: 2 },
    emailText: { flex: 1, fontSize: 16, color: '#6b7280' },

    deleteButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        minHeight: 60,
        marginTop: 48,
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#fecaca',
        backgroundColor: '#fef2f2',
    },
    deleteText: { fontSize: 17, fontWeight: '600', color: '#dc2626' },
});
