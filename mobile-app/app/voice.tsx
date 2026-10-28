import React, { useCallback, useEffect, useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ScrollView,
    ActivityIndicator,
    Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Mic, Upload, Trash2, Check, FileAudio } from 'lucide-react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import * as DocumentPicker from 'expo-document-picker';
import { fetchVoice, uploadVoice, deleteVoice, Voice } from '../utils/voice';

interface PickedFile {
    uri: string;
    name: string;
    mimeType: string;
}

export default function VoiceScreen() {
    const router = useRouter();
    const [voice, setVoice] = useState<Voice | null>(null);
    const [loading, setLoading] = useState(true);
    const [file, setFile] = useState<PickedFile | null>(null);
    const [consent, setConsent] = useState(false);
    const [uploading, setUploading] = useState(false);

    const load = useCallback(async () => {
        try {
            setVoice(await fetchVoice());
        } catch {
            // Keep the previous value; the cloud status indicator already shows reachability.
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        load();
    }, [load]);

    useFocusEffect(
        useCallback(() => {
            load();
        }, [load])
    );

    const pickFile = async () => {
        const result = await DocumentPicker.getDocumentAsync({
            type: 'audio/*',
            copyToCacheDirectory: true,
            multiple: false,
        });
        if (result.canceled || !result.assets.length) return;
        const asset = result.assets[0];
        setFile({ uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'audio/mpeg' });
    };

    const handleUpload = async () => {
        if (!file) return;
        setUploading(true);
        try {
            setVoice(await uploadVoice({
                uri: file.uri,
                fileName: file.name,
                mimeType: file.mimeType,
                name: voice?.name || 'Meine Stimme',
                consent,
            }));
            setFile(null);
            setConsent(false);
        } catch (e) {
            Alert.alert('Hochladen fehlgeschlagen', 'Die Stimme konnte nicht erstellt werden.');
        } finally {
            setUploading(false);
        }
    };

    const handleDelete = () => {
        Alert.alert(
            'Stimme löschen',
            'Deine geklonte Stimme wird entfernt. Danach wird wieder die Standardstimme verwendet.',
            [
                { text: 'Abbrechen', style: 'cancel' },
                {
                    text: 'Löschen',
                    style: 'destructive',
                    onPress: async () => {
                        try {
                            await deleteVoice();
                            setVoice(null);
                        } catch {
                            Alert.alert('Löschen fehlgeschlagen', 'Die Stimme konnte nicht gelöscht werden.');
                        }
                    },
                },
            ]
        );
    };

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.headerIcon}>
                    <ChevronLeft size={26} color="#374151" />
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle}>Meine Stimme</Text>
                </View>
                <View style={styles.headerIcon} />
            </View>

            <ScrollView contentContainerStyle={styles.scroll}>
                {loading ? (
                    <ActivityIndicator size="large" color="#0ea5e9" style={styles.spinner} />
                ) : (
                    <>
                        {voice ? (
                            <View style={styles.card}>
                                <View style={styles.cardHeader}>
                                    <Mic size={24} color="#0ea5e9" />
                                    <View style={styles.cardHeaderText}>
                                        <Text style={styles.cardTitle}>{voice.name}</Text>
                                        <Text style={styles.cardSubtitle}>Aktive Stimme</Text>
                                    </View>
                                </View>
                            </View>
                        ) : (
                            <View style={styles.card}>
                                <Text style={styles.cardTitle}>Noch keine eigene Stimme</Text>
                                <Text style={styles.cardSubtitle}>
                                    Lade eine Audiodatei mit deiner Stimme hoch, um sie für die
                                    Sprachausgabe zu verwenden. Andernfalls wird die Standardstimme genutzt.
                                </Text>
                            </View>
                        )}

                        <TouchableOpacity
                            style={styles.pickButton}
                            onPress={pickFile}
                            accessibilityRole="button"
                            accessibilityLabel="Audiodatei auswählen"
                        >
                            <FileAudio size={22} color="#0ea5e9" />
                            <Text style={styles.pickButtonText}>
                                {file ? file.name : 'Audiodatei auswählen'}
                            </Text>
                        </TouchableOpacity>

                        {file && (
                            <>
                                <TouchableOpacity
                                    style={styles.consentRow}
                                    onPress={() => setConsent((c) => !c)}
                                    accessibilityRole="checkbox"
                                    accessibilityState={{ checked: consent }}
                                    accessibilityLabel="Einwilligung zur Stimmklonierung"
                                >
                                    <View style={[styles.checkbox, consent && styles.checkboxChecked]}>
                                        {consent && <Check size={16} color="#ffffff" />}
                                    </View>
                                    <Text style={styles.consentText}>
                                        Ich willige ein, dass diese Aufnahme zur Erstellung einer
                                        geklonten Stimme an Mistral übertragen wird.
                                    </Text>
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.uploadButton, (!consent || uploading) && styles.disabled]}
                                    onPress={handleUpload}
                                    disabled={!consent || uploading}
                                    accessibilityRole="button"
                                    accessibilityLabel="Stimme hochladen"
                                >
                                    {uploading ? (
                                        <ActivityIndicator color="#ffffff" />
                                    ) : (
                                        <>
                                            <Upload size={20} color="#ffffff" />
                                            <Text style={styles.uploadButtonText}>Stimme hochladen</Text>
                                        </>
                                    )}
                                </TouchableOpacity>
                            </>
                        )}

                        {voice && (
                            <TouchableOpacity
                                style={styles.deleteButton}
                                onPress={handleDelete}
                                accessibilityRole="button"
                                accessibilityLabel="Stimme löschen"
                            >
                                <Trash2 size={20} color="#e11d48" />
                                <Text style={styles.deleteButtonText}>Stimme löschen</Text>
                            </TouchableOpacity>
                        )}
                    </>
                )}
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
        paddingVertical: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
        backgroundColor: '#ffffff',
    },
    headerIcon: { padding: 8, width: 42 },
    headerTitleContainer: { flex: 1, alignItems: 'center' },
    headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#111827' },

    scroll: { padding: 16 },
    spinner: { marginTop: 60 },

    card: {
        backgroundColor: '#ffffff',
        borderRadius: 14,
        padding: 16,
        borderWidth: 1,
        borderColor: '#eef2f7',
        marginBottom: 16,
        gap: 6,
    },
    cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    cardHeaderText: { flex: 1 },
    cardTitle: { fontSize: 16, fontWeight: '600', color: '#1e293b' },
    cardSubtitle: { fontSize: 14, color: '#64748b', lineHeight: 20 },

    pickButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingVertical: 16,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#bae6fd',
        backgroundColor: '#f0f9ff',
        marginBottom: 16,
    },
    pickButtonText: { fontSize: 16, fontWeight: '600', color: '#0284c7', flexShrink: 1 },

    consentRow: {
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 12,
        marginBottom: 16,
    },
    checkbox: {
        width: 24,
        height: 24,
        borderRadius: 6,
        borderWidth: 2,
        borderColor: '#94a3b8',
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 2,
    },
    checkboxChecked: { backgroundColor: '#0ea5e9', borderColor: '#0ea5e9' },
    consentText: { flex: 1, fontSize: 14, color: '#475569', lineHeight: 20 },

    uploadButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingVertical: 16,
        borderRadius: 14,
        backgroundColor: '#0ea5e9',
        marginBottom: 16,
    },
    uploadButtonText: { fontSize: 16, fontWeight: '700', color: '#ffffff' },
    disabled: { opacity: 0.5 },

    deleteButton: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        paddingVertical: 16,
        borderRadius: 14,
        borderWidth: 1,
        borderColor: '#fecdd3',
        backgroundColor: '#fff1f2',
    },
    deleteButtonText: { fontSize: 15, fontWeight: '600', color: '#e11d48' },
});
