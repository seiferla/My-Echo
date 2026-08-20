import React, { useEffect, useRef, useState } from 'react';
import {
    View,
    Text,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    TextInput,
    Modal,
    Switch,
    Alert,
    Animated,
    PanResponder,
    KeyboardAvoidingView,
    Platform,
} from 'react-native';
import type { PanResponderInstance } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
    ChevronLeft,
    ChevronUp,
    ChevronDown,
    Plus,
    Pencil,
    Trash2,
    Volume2,
    Pilcrow,
    GripVertical,
    X,
    Check,
} from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { usePhrases } from '../context/PhrasesContext';
import { MAX_VISIBLE_PHRASES, Phrase, reorder } from '../utils/phrases';

// Feste Zeilenhöhe — das Drag & Drop rechnet die Zielposition aus der
// Fingerbewegung (dy / STEP). Ohne feste Höhe wäre diese Rechnung nicht möglich.
const ROW_H = 88;
const ROW_GAP = 10;
const STEP = ROW_H + ROW_GAP;

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

export default function PhrasesScreen() {
    const router = useRouter();
    const {
        phrases,
        settings,
        addPhrase,
        updatePhrase,
        deletePhrase,
        movePhrase,
        reorderPhrases,
        setVisibleCount,
        setInstantEnabled,
    } = usePhrases();

    // editing === null → Editor geschlossen. editing === 'new' → neue Phrase.
    const [editing, setEditing] = useState<'new' | Phrase | null>(null);
    const [draftText, setDraftText] = useState('');
    const editorScrollRef = useRef<ScrollView>(null);

    // --- Drag & Drop ---------------------------------------------------------
    // dragIndex = Position, an der die Phrase aufgenommen wurde.
    // targetIndex = Position, an der sie beim Loslassen landen würde.
    const [dragIndex, setDragIndex] = useState<number | null>(null);
    const [targetIndex, setTargetIndex] = useState<number | null>(null);
    const targetRef = useRef<number | null>(null);
    // Position, an der die Karte aufgenommen wurde — Basis für die dy-Rechnung.
    const startRef = useRef<number | null>(null);
    // Immer der aktuelle Stand der Liste, lesbar aus den Gesten-Callbacks.
    const phrasesRef = useRef(phrases);
    phrasesRef.current = phrases;
    // Absolute Y-Position der schwebenden Karte innerhalb der Liste.
    const dragY = useRef(new Animated.Value(0)).current;

    const endDrag = () => {
        setDragIndex(null);
        setTargetIndex(null);
        targetRef.current = null;
        startRef.current = null;
    };

    // Die PanResponder müssen über Re-Renders hinweg dieselben Objekte bleiben:
    // ein neu erzeugter Responder hätte mitten in der Geste wieder dy = 0 und
    // die Karte würde zurückspringen. Deshalb einmal pro Phrase anlegen und
    // merken; die Position wird zur Laufzeit über die Refs geholt.
    const respondersRef = useRef(new Map<string, PanResponderInstance>());

    const getDragResponder = (id: string): PanResponderInstance => {
        const existing = respondersRef.current.get(id);
        if (existing) return existing;

        const responder = PanResponder.create({
            onStartShouldSetPanResponder: () => true,
            // Erst ab ein paar Pixeln übernehmen, damit ein Antippen des Griffs
            // die Liste nicht sofort in den Drag-Modus zwingt.
            onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 2,
            onPanResponderGrant: () => {
                const index = phrasesRef.current.findIndex((p) => p.id === id);
                if (index < 0) return;
                startRef.current = index;
                targetRef.current = index;
                setDragIndex(index);
                setTargetIndex(index);
                dragY.setValue(index * STEP);
            },
            onPanResponderMove: (_, g) => {
                const start = startRef.current;
                if (start === null) return;
                const y = start * STEP + g.dy;
                dragY.setValue(y);
                const next = clamp(Math.round(y / STEP), 0, phrasesRef.current.length - 1);
                if (next !== targetRef.current) {
                    targetRef.current = next;
                    setTargetIndex(next);
                }
            },
            onPanResponderRelease: () => {
                const start = startRef.current;
                const to = targetRef.current;
                if (start !== null && to !== null && to !== start) reorderPhrases(start, to);
                endDrag();
            },
            onPanResponderTerminate: endDrag,
            // Ohne das darf die umgebende ScrollView die Geste an sich reißen,
            // sobald der Finger senkrecht wandert — der Drag bräche dann ab.
            onPanResponderTerminationRequest: () => false,
            onShouldBlockNativeResponder: () => true,
        });
        respondersRef.current.set(id, responder);
        return responder;
    };

    // Responder gelöschter Phrasen aufräumen, damit die Map nicht mitwächst.
    useEffect(() => {
        const alive = new Set(phrases.map((p) => p.id));
        for (const id of respondersRef.current.keys()) {
            if (!alive.has(id)) respondersRef.current.delete(id);
        }
    }, [phrases]);

    // Während des Ziehens zeigt die Liste schon die künftige Reihenfolge.
    const preview =
        dragIndex !== null && targetIndex !== null
            ? reorder(phrases, dragIndex, targetIndex)
            : phrases;
    const draggedPhrase = dragIndex !== null ? phrases[dragIndex] : null;

    // --- Editor --------------------------------------------------------------
    const openNew = () => {
        setDraftText('');
        setEditing('new');
    };

    const openEdit = (phrase: Phrase) => {
        setDraftText(phrase.text);
        setEditing(phrase);
    };

    const submit = () => {
        if (!draftText.trim()) return;
        if (editing === 'new') addPhrase(draftText);
        else if (editing) updatePhrase(editing.id, draftText);
        setEditing(null);
    };

    const confirmDelete = (phrase: Phrase) => {
        Alert.alert('Phrase löschen', `„${phrase.text}" wirklich löschen?`, [
            { text: 'Abbrechen', style: 'cancel' },
            { text: 'Löschen', style: 'destructive', onPress: () => deletePhrase(phrase.id) },
        ]);
    };

    // --- Karte ---------------------------------------------------------------
    const renderCard = (phrase: Phrase, index: number, floating = false) => {
        const isVisibleInChat = index < settings.visibleCount;
        const speaks = settings.instantEnabled;
        const isPlaceholder = !floating && draggedPhrase?.id === phrase.id;

        return (
            <View
                style={[
                    styles.card,
                    isVisibleInChat && styles.cardVisible,
                    floating && styles.cardFloating,
                    isPlaceholder && styles.cardPlaceholder,
                ]}
            >
                <View style={styles.cardTop}>
                    <View
                        style={styles.grip}
                        {...(floating ? {} : getDragResponder(phrase.id).panHandlers)}
                        accessibilityLabel="Zum Verschieben ziehen"
                    >
                        <GripVertical size={20} color="#9ca3af" />
                    </View>
                    {speaks ? (
                        <Volume2 size={18} color="#0ea5e9" />
                    ) : (
                        <Pilcrow size={18} color="#9ca3af" />
                    )}
                    <Text style={styles.cardText} numberOfLines={1}>
                        {phrase.text}
                    </Text>
                    <TouchableOpacity
                        onPress={() => openEdit(phrase)}
                        style={styles.iconButton}
                        accessibilityLabel="Bearbeiten"
                    >
                        <Pencil size={20} color="#4b5563" />
                    </TouchableOpacity>
                    <TouchableOpacity
                        onPress={() => confirmDelete(phrase)}
                        style={styles.iconButton}
                        accessibilityLabel="Löschen"
                    >
                        <Trash2 size={20} color="#ef4444" />
                    </TouchableOpacity>
                </View>

                <View style={styles.cardBottom}>
                    <Text style={styles.cardMeta} numberOfLines={1}>
                        {speaks ? 'Spricht sofort' : 'Füllt die Eingabe'}
                        {phrase.useCount > 0 ? ` · ${phrase.useCount}×` : ''}
                        {isVisibleInChat ? ' · im Chat' : ''}
                    </Text>
                    {/* Pfeile bleiben als Alternative zum Ziehen — feinmotorisch
                        deutlich anspruchsloser als eine Drag-Geste. */}
                    <View style={styles.arrowRow}>
                        <TouchableOpacity
                            onPress={() => movePhrase(phrase.id, -1)}
                            disabled={index === 0}
                            style={[styles.iconButton, index === 0 && styles.iconDisabled]}
                            accessibilityLabel="Nach oben"
                        >
                            <ChevronUp size={20} color="#4b5563" />
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={() => movePhrase(phrase.id, 1)}
                            disabled={index === phrases.length - 1}
                            style={[
                                styles.iconButton,
                                index === phrases.length - 1 && styles.iconDisabled,
                            ]}
                            accessibilityLabel="Nach unten"
                        >
                            <ChevronDown size={20} color="#4b5563" />
                        </TouchableOpacity>
                    </View>
                </View>
            </View>
        );
    };

    const countOptions = [0, ...Array.from({ length: MAX_VISIBLE_PHRASES }, (_, i) => i + 1)];

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.headerIcon}>
                    <ChevronLeft size={26} color="#374151" />
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle}>Phrasen</Text>
                </View>
                <TouchableOpacity onPress={openNew} style={styles.headerIcon}>
                    <Plus size={26} color="#0ea5e9" />
                </TouchableOpacity>
            </View>

            <ScrollView
                contentContainerStyle={styles.list}
                // Während des Ziehens darf die Liste nicht mitscrollen, sonst
                // springt die Karte unter dem Finger weg.
                scrollEnabled={dragIndex === null}
            >
                {/* Einstellungen */}
                <View style={styles.settingsCard}>
                    <Text style={styles.settingsLabel}>Im Chat anzeigen</Text>
                    <View style={styles.segment}>
                        {countOptions.map((count) => (
                            <TouchableOpacity
                                key={count}
                                onPress={() => setVisibleCount(count)}
                                style={[
                                    styles.segmentItem,
                                    settings.visibleCount === count && styles.segmentItemActive,
                                ]}
                            >
                                <Text
                                    style={[
                                        styles.segmentText,
                                        settings.visibleCount === count && styles.segmentTextActive,
                                    ]}
                                >
                                    {count === 0 ? 'Aus' : count}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                    <Text style={styles.settingsHint}>
                        Die obersten {settings.visibleCount === 0 ? '0' : settings.visibleCount}{' '}
                        Phrasen dieser Liste liegen im Chat bereit.
                    </Text>

                    <View style={styles.settingsDivider} />

                    <View style={styles.switchRow}>
                        <View style={styles.switchTexts}>
                            <Text style={styles.settingsLabel}>Sofort sprechen</Text>
                            <Text style={styles.settingsHint}>
                                Gilt für alle Phrasen. An: Antippen sendet und spricht direkt.
                                Aus: der Text landet nur im Eingabefeld — es wird nichts
                                ungefragt gesprochen.
                            </Text>
                        </View>
                        <Switch
                            value={settings.instantEnabled}
                            onValueChange={setInstantEnabled}
                            trackColor={{ true: '#7dd3fc', false: '#d1d5db' }}
                            thumbColor={settings.instantEnabled ? '#0ea5e9' : '#f3f4f6'}
                        />
                    </View>
                </View>

                <Text style={styles.hint}>
                    Reihenfolge ändern: am Griff ziehen oder die Pfeile benutzen.
                </Text>

                {/* Liste mit fester Zeilenhöhe — Basis für das Ziehen */}
                <View style={styles.rows}>
                    {preview.map((phrase) => {
                        // Der Index in der Vorschau bestimmt die Position; für die
                        // Aktionen zählt der echte Index in der gespeicherten Liste.
                        const realIndex = phrases.findIndex((p) => p.id === phrase.id);
                        const previewIndex = preview.findIndex((p) => p.id === phrase.id);
                        return (
                            <View key={phrase.id} style={styles.row}>
                                {renderCard(
                                    phrase,
                                    dragIndex === null ? realIndex : previewIndex
                                )}
                            </View>
                        );
                    })}

                    {/* Schwebende Kopie, die dem Finger folgt */}
                    {draggedPhrase && (
                        <Animated.View
                            pointerEvents="none"
                            style={[styles.floating, { transform: [{ translateY: dragY }] }]}
                        >
                            {renderCard(draggedPhrase, targetIndex ?? 0, true)}
                        </Animated.View>
                    )}
                </View>

                {phrases.length === 0 && (
                    <Text style={styles.empty}>Noch keine Phrasen. Oben rechts auf + tippen.</Text>
                )}
            </ScrollView>

            <TouchableOpacity onPress={openNew} style={styles.fab} accessibilityLabel="Phrase hinzufügen">
                <Plus size={28} color="#ffffff" />
            </TouchableOpacity>

            {/* Editor für neue und bestehende Phrasen — bewusst derselbe
                Vollbild-Aufbau wie beim Schreiben einer Nachricht (siehe
                ChatArea): große Schrift, viel Platz, gleiche Bedienung. */}
            <Modal
                visible={editing !== null}
                animationType="slide"
                presentationStyle="fullScreen"
                onRequestClose={() => setEditing(null)}
            >
                <SafeAreaView style={styles.editorContainer} edges={['top', 'left', 'right']}>
                    <View style={styles.editorHeader}>
                        <TouchableOpacity onPress={() => setEditing(null)} style={styles.editorButton}>
                            <X size={32} color="#4b5563" />
                        </TouchableOpacity>
                        <TouchableOpacity
                            onPress={submit}
                            disabled={!draftText.trim()}
                            style={[
                                styles.editorButton,
                                styles.editorSave,
                                !draftText.trim() && styles.editorDisabled,
                            ]}
                        >
                            <Check size={32} color="white" />
                        </TouchableOpacity>
                    </View>

                    <KeyboardAvoidingView
                        style={{ flex: 1 }}
                        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
                    >
                        <ScrollView
                            ref={editorScrollRef}
                            style={{ flex: 1 }}
                            keyboardShouldPersistTaps="handled"
                            onContentSizeChange={() =>
                                editorScrollRef.current?.scrollToEnd({ animated: false })
                            }
                        >
                            <TextInput
                                style={styles.editorInput}
                                value={draftText}
                                onChangeText={setDraftText}
                                placeholder="Phrase eingeben..."
                                placeholderTextColor="#9ca3af"
                                multiline
                                autoFocus
                                textAlignVertical="top"
                                scrollEnabled={false}
                            />
                        </ScrollView>

                    </KeyboardAvoidingView>
                </SafeAreaView>
            </Modal>

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
    headerIcon: { padding: 8 },
    headerTitleContainer: { flex: 1, alignItems: 'center' },
    headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#111827' },

    list: { padding: 16, paddingBottom: 100 },

    settingsCard: {
        backgroundColor: '#ffffff',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        padding: 16,
        marginBottom: 16,
    },
    settingsLabel: { fontSize: 16, fontWeight: '600', color: '#374151' },
    settingsHint: { fontSize: 12, color: '#6b7280', marginTop: 4, lineHeight: 17 },
    settingsDivider: {
        height: 1,
        backgroundColor: '#f3f4f6',
        marginVertical: 14,
    },
    segment: {
        flexDirection: 'row',
        backgroundColor: '#f3f4f6',
        borderRadius: 12,
        padding: 4,
        marginTop: 10,
    },
    segmentItem: {
        flex: 1,
        paddingVertical: 10,
        borderRadius: 9,
        alignItems: 'center',
    },
    segmentItemActive: { backgroundColor: '#0ea5e9' },
    segmentText: { fontSize: 16, fontWeight: '600', color: '#4b5563' },
    segmentTextActive: { color: '#ffffff' },

    hint: { fontSize: 13, color: '#6b7280', marginBottom: 12 },

    rows: { position: 'relative' },
    row: { height: ROW_H, marginBottom: ROW_GAP },
    floating: {
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        height: ROW_H,
    },

    card: {
        height: ROW_H,
        backgroundColor: '#ffffff',
        borderRadius: 16,
        borderWidth: 1,
        borderColor: '#e5e7eb',
        paddingHorizontal: 10,
        paddingVertical: 8,
        justifyContent: 'space-between',
    },
    // Hebt die Phrasen hervor, die tatsächlich im Chat sichtbar sind.
    cardVisible: {
        borderColor: '#bae6fd',
        backgroundColor: '#f0f9ff',
    },
    // Die Karte am Finger — angehoben durch Schatten und leichte Neigung.
    cardFloating: {
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius: 12,
        elevation: 8,
        transform: [{ scale: 1.02 }],
    },
    // Die Lücke, aus der die Karte gerade herausgezogen wurde.
    cardPlaceholder: {
        opacity: 0.25,
        borderStyle: 'dashed',
        borderColor: '#0ea5e9',
    },
    cardTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    grip: { paddingVertical: 6, paddingHorizontal: 2 },
    cardText: { fontSize: 16, color: '#111827', fontWeight: '500', flex: 1 },
    cardBottom: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    cardMeta: { fontSize: 12, color: '#6b7280', flex: 1 },
    arrowRow: { flexDirection: 'row' },
    iconButton: { padding: 6 },
    iconDisabled: { opacity: 0.3 },
    empty: { fontSize: 16, color: '#6b7280', textAlign: 'center', marginTop: 40 },

    fab: {
        position: 'absolute',
        right: 20,
        bottom: 32,
        width: 56,
        height: 56,
        borderRadius: 28,
        backgroundColor: '#0ea5e9',
        justifyContent: 'center',
        alignItems: 'center',
        elevation: 4,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.2,
        shadowRadius: 6,
    },

    editorContainer: { flex: 1, backgroundColor: '#ffffff' },
    editorHeader: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        padding: 20,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    editorButton: { padding: 10, borderRadius: 30 },
    editorSave: { backgroundColor: '#10b981' },
    editorDisabled: { opacity: 0.4 },
    // Gleiche Schriftgröße wie im Nachrichten-Editor der ChatArea.
    editorInput: {
        minHeight: 200,
        padding: 20,
        fontSize: 32,
        color: '#111827',
        fontWeight: '500',
    },
    switchRow: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        marginTop: 16,
    },
    switchTexts: { flex: 1 },
});
