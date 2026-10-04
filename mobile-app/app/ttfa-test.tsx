import React, { useState } from 'react';
import {
    View,
    Text,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    Alert,
    ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, Play, Download } from 'lucide-react-native';
import { useRouter } from 'expo-router';
import { useCloudStatus } from '../context/CloudStatusContext';
import { speak, stopSpeaking, getShareableAudioUri } from '../utils/tts';
import { clearCache, getCachedUri } from '../utils/ttsCache';
import { SENTENCE_STREAMING } from '../utils/config';

// Testkorpus: realistische AAC-Nachrichten, verschiedene Längen und Satzzahlen.
// Lange Texte laufen über den Stream-Pfad, kurze (<60 Zeichen) über Download.
const CORPUS: string[] = [
    'Ja, das klingt gut.',
    'Ich hätte gerne ein Glas Wasser. Können Sie mir das bitte bringen?',
    'Guten Morgen. Ich möchte heute einen Termin vereinbaren. Geht das am Dienstag um zehn Uhr? Falls nicht, wäre auch Donnerstag möglich.',
    'Hallo zusammen. Ich wollte nur kurz Bescheid geben, dass ich heute etwas später komme. Der Zug hatte Verspätung, und dann war noch die Straße gesperrt.',
    'Vielen Dank für Ihre Hilfe. Das war wirklich sehr nett von Ihnen. Ich wünsche Ihnen noch einen schönen Tag und bis bald.',
];

interface RunResult {
    text: string;
    chars: number;
    cached: boolean;
    ttfaMs: number | null;
}

interface Summary {
    n: number;
    avg: number;
    median: number;
    p95: number;
    max: number;
}

function delay(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}

function percentile(sorted: number[], q: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1);
    return sorted[Math.max(0, idx)];
}

function summarize(ttfas: number[]): Summary {
    const xs = ttfas.slice().sort((a, b) => a - b);
    const avg = xs.length ? Math.round(xs.reduce((s, x) => s + x, 0) / xs.length) : 0;
    return {
        n: xs.length,
        avg,
        median: percentile(xs, 0.5),
        p95: percentile(xs, 0.95),
        max: xs.length ? xs[xs.length - 1] : 0,
    };
}

export default function TtfaTestScreen() {
    const router = useRouter();
    const { isAvailable, voice, model } = useCloudStatus();
    const [results, setResults] = useState<RunResult[]>([]);
    const [running, setRunning] = useState(false);

    const run = async (preload: boolean) => {
        if (!isAvailable) {
            Alert.alert('Nicht verfügbar', 'Cloud-Sprachausgabe ist nicht erreichbar. TTFA-Test ist nur mit Cloud-TTS sinnvoll.');
            return;
        }
        setRunning(true);
        setResults([]);
        try {
            if (preload) {
                // Alles in den Cache laden, ohne abzuspielen — simuliert den
                // Best-Case "Satz schon synthetisiert" der Vorab-Synthese.
                for (const text of CORPUS) {
                    await getShareableAudioUri(text, true, voice, model);
                }
            } else {
                await clearCache();
            }

            const next: RunResult[] = [];
            for (const text of CORPUS) {
                const cached = (await getCachedUri(text, voice, model)) !== null;
                const t0 = Date.now();
                let ttfaMs: number | null = null;

                try {
                    await speak(text, true, voice, model, () => {
                        // Erster Ton da → TTFA festhalten und Rest abbrechen,
                        // damit der Test nicht die volle Wiedergabe abwartet.
                        ttfaMs = Date.now() - t0;
                        stopSpeaking();
                    });
                } catch {
                    // Absichtlicher Abbruch nach dem ersten Ton — normal.
                }

                next.push({ text, chars: text.length, cached, ttfaMs });
                setResults([...next]);
                await delay(400);
            }
        } finally {
            setRunning(false);
        }
    };

    const summary = summarize(results.map((r) => r.ttfaMs).filter((x): x is number => x !== null));

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.headerIcon}>
                    <ChevronLeft size={26} color="#374151" />
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle}>TTFA-Test</Text>
                </View>
                <View style={styles.headerIcon} />
            </View>

            <ScrollView contentContainerStyle={styles.scroll}>
                <View style={styles.infoCard}>
                    <Text style={styles.infoLine}>
                        Modus: <Text style={styles.infoValue}>{SENTENCE_STREAMING ? 'Satz-Streaming' : 'Einzel-Stream'}</Text>
                    </Text>
                    <Text style={styles.infoLine}>
                        Cloud: <Text style={styles.infoValue}>{isAvailable ? `verfügbar (${voice || '?'})` : 'nicht erreichbar'}</Text>
                    </Text>
                    <Text style={styles.infoHint}>
                        TTFA = Zeit von „Sprechen“ bis zum ersten hörbaren Ton. „Kalt“ misst die Synthese,
                        „Warm“ den Cache-Hit (Ziel der Satz-Vorab-Synthese).
                    </Text>
                </View>

                <View style={styles.buttonRow}>
                    <TouchableOpacity
                        style={[styles.runBtn, styles.coldBtn, running && styles.disabled]}
                        onPress={() => run(false)}
                        disabled={running}
                    >
                        <Play size={20} color="#ffffff" />
                        <Text style={styles.runBtnText}>Kalt messen</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.runBtn, styles.warmBtn, running && styles.disabled]}
                        onPress={() => run(true)}
                        disabled={running}
                    >
                        <Download size={20} color="#ffffff" />
                        <Text style={styles.runBtnText}>Warm messen</Text>
                    </TouchableOpacity>
                </View>

                {running && (
                    <View style={styles.runningRow}>
                        <ActivityIndicator color="#0ea5e9" />
                        <Text style={styles.runningText}>Messe…</Text>
                    </View>
                )}

                {results.length > 0 && (
                    <>
                        <View style={styles.summaryCard}>
                            <Text style={styles.sectionTitle}>Zusammenfassung (ms)</Text>
                            <View style={styles.summaryRow}>
                                <SummaryCell label="Ø" value={summary.avg} />
                                <SummaryCell label="Median" value={summary.median} />
                                <SummaryCell label="p95" value={summary.p95} />
                                <SummaryCell label="Max" value={summary.max} />
                            </View>
                        </View>

                        {results.map((r, i) => (
                            <View key={i} style={styles.resultCard}>
                                <View style={styles.resultHeader}>
                                    <Text style={styles.resultPath}>
                                        {r.cached ? 'Cache-Hit' : 'Synthese'}
                                    </Text>
                                    <Text style={styles.resultTtfa}>
                                        {r.ttfaMs === null ? '–' : `${r.ttfaMs} ms`}
                                    </Text>
                                </View>
                                <Text style={styles.resultText} numberOfLines={2}>
                                    {r.text}
                                </Text>
                                <Text style={styles.resultChars}>{r.chars} Zeichen</Text>
                            </View>
                        ))}
                    </>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

function SummaryCell({ label, value }: { label: string; value: number }) {
    return (
        <View style={styles.summaryCell}>
            <Text style={styles.summaryValue}>{value}</Text>
            <Text style={styles.summaryLabel}>{label}</Text>
        </View>
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

    infoCard: {
        backgroundColor: '#ffffff',
        borderRadius: 14,
        padding: 16,
        borderWidth: 1,
        borderColor: '#eef2f7',
        marginBottom: 12,
    },
    infoLine: { fontSize: 15, color: '#475569', marginBottom: 4 },
    infoValue: { fontWeight: '700', color: '#0ea5e9' },
    infoHint: { fontSize: 12, color: '#94a3b8', lineHeight: 18, marginTop: 8 },

    buttonRow: { flexDirection: 'row', gap: 12, marginBottom: 12 },
    runBtn: {
        flex: 1,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderRadius: 12,
        paddingVertical: 14,
    },
    coldBtn: { backgroundColor: '#0ea5e9' },
    warmBtn: { backgroundColor: '#10b981' },
    runBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '700' },
    disabled: { opacity: 0.5 },

    runningRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
    runningText: { color: '#475569', fontSize: 14 },

    summaryCard: {
        backgroundColor: '#ffffff',
        borderRadius: 14,
        padding: 16,
        borderWidth: 1,
        borderColor: '#eef2f7',
        marginBottom: 12,
    },
    sectionTitle: { fontSize: 15, fontWeight: '700', color: '#0f172a', marginBottom: 12 },
    summaryRow: { flexDirection: 'row', gap: 8 },
    summaryCell: {
        flex: 1,
        backgroundColor: '#f8fafc',
        borderRadius: 10,
        paddingVertical: 12,
        alignItems: 'center',
    },
    summaryValue: { fontSize: 20, fontWeight: '800', color: '#0ea5e9' },
    summaryLabel: { fontSize: 12, color: '#64748b', marginTop: 2 },

    resultCard: {
        backgroundColor: '#ffffff',
        borderRadius: 14,
        padding: 16,
        borderWidth: 1,
        borderColor: '#eef2f7',
        marginBottom: 8,
    },
    resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
    resultPath: { fontSize: 13, fontWeight: '700', color: '#64748b' },
    resultTtfa: { fontSize: 20, fontWeight: '800', color: '#111827' },
    resultText: { fontSize: 14, color: '#1e293b', lineHeight: 20 },
    resultChars: { fontSize: 12, color: '#94a3b8', marginTop: 4 },
});
