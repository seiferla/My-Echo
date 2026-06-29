import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
    View,
    Text,
    ScrollView,
    StyleSheet,
    TouchableOpacity,
    Alert,
    Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, BarChart3 } from 'lucide-react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { BarChart, PieChart } from 'react-native-chart-kit';
import {
    Chat,
    FlatMessage,
    loadChats,
    flattenMessages,
    filterByRange,
    messagesPerDay,
    messagesPerWeek,
    timeOfDayDistribution,
    topPhrases,
    topWords,
    computeTotals,
    summarizeTts,
    ttsAudioPerMonth,
    loadTtsStats,
    TtsStats,
    TtsSummary,
} from '../utils/stats';
import { getCacheStats, clearCache, CacheStats } from '../utils/ttsCache';

const screenWidth = Dimensions.get('window').width;
const chartWidth = Math.min(screenWidth - 32, 560);

const chartConfig = {
    backgroundGradientFrom: '#ffffff',
    backgroundGradientTo: '#ffffff',
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(14, 165, 233, ${opacity})`,
    labelColor: (opacity = 1) => `rgba(75, 85, 99, ${opacity})`,
    barPercentage: 0.6,
    propsForBackgroundLines: { stroke: '#f1f5f9' },
};

type RangePreset = '7' | '30' | '90' | 'all';
type Mode = 'range' | 'day';

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ts: number): number {
    const d = new Date(ts);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function formatDate(ts: number): string {
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

/** Blendet Achsenbeschriftungen aus, wenn zu viele Balken vorhanden sind. */
function thinLabels(labels: string[], max = 8): string[] {
    if (labels.length <= max) return labels;
    const step = Math.ceil(labels.length / max);
    return labels.map((l, i) => (i % step === 0 ? l : ''));
}

export default function StatsScreen() {
    const router = useRouter();
    const [chats, setChats] = useState<Chat[]>([]);
    const [ttsStats, setTtsStats] = useState<TtsStats>({});
    const [cacheStats, setCacheStats] = useState<CacheStats | null>(null);
    const [loading, setLoading] = useState(true);

    const [mode, setMode] = useState<Mode>('range');
    const [preset, setPreset] = useState<RangePreset>('30');
    const [day, setDay] = useState<number>(startOfDay(Date.now()));

    useEffect(() => {
        (async () => {
            const [c, t, cs] = await Promise.all([
                loadChats(),
                loadTtsStats(),
                getCacheStats().catch(() => null),
            ]);
            setChats(c);
            setTtsStats(t);
            setCacheStats(cs);
            setLoading(false);
        })();
    }, []);

    useFocusEffect(
        useCallback(() => {
            let cancelled = false;
            getCacheStats()
                .then((cs) => { if (!cancelled) setCacheStats(cs); })
                .catch(() => { /* keep previous value */ });
            return () => { cancelled = true; };
        }, [])
    );

    async function handleClearCache() {
        Alert.alert(
            'Cache leeren',
            'Alle zwischengespeicherten Audio-Dateien werden gelöscht. Beim nächsten Abspielen wird das Audio neu geladen.',
            [
                { text: 'Abbrechen', style: 'cancel' },
                {
                    text: 'Leeren',
                    style: 'destructive',
                    onPress: async () => {
                        await clearCache();
                        const cs = await getCacheStats();
                        setCacheStats(cs);
                    },
                },
            ]
        );
    }

    const allMsgs: FlatMessage[] = useMemo(() => flattenMessages(chats), [chats]);

    const { from, to } = useMemo(() => {
        const now = Date.now();
        if (mode === 'day') {
            return { from: day, to: day + DAY_MS - 1 };
        }
        if (preset === 'all') {
            const earliest = allMsgs.length ? allMsgs[0].ts : now;
            return { from: startOfDay(earliest), to: now };
        }
        const days = parseInt(preset, 10);
        return { from: startOfDay(now) - (days - 1) * DAY_MS, to: now };
    }, [mode, preset, day, allMsgs]);

    const msgs = useMemo(() => filterByRange(allMsgs, from, to), [allMsgs, from, to]);
    const totals = useMemo(() => computeTotals(msgs), [msgs]);
    const phrases = useMemo(() => topPhrases(msgs, 8), [msgs]);
    const words = useMemo(() => topWords(msgs, 10), [msgs]);
    const tts: TtsSummary = useMemo(() => summarizeTts(ttsStats, from, to), [ttsStats, from, to]);
    // Audio-Minuten pro Monat — bewusst über ALLE Daten, unabhängig vom Zeitfilter.
    const audioPerMonth = useMemo(() => ttsAudioPerMonth(ttsStats), [ttsStats]);

    // Pro Tag bei kurzen Zeiträumen, pro Woche bei langen.
    const rangeDays = Math.round((to - from) / DAY_MS) + 1;
    const timeSeries = useMemo(() => {
        if (mode === 'day') return [];
        return rangeDays > 31 ? messagesPerWeek(msgs) : messagesPerDay(msgs, from, to);
    }, [msgs, from, to, mode, rangeDays]);

    const todBuckets = useMemo(() => timeOfDayDistribution(msgs), [msgs]);

    const goPrevDay = () => setDay((d) => d - DAY_MS);
    const goNextDay = () => setDay((d) => Math.min(d + DAY_MS, startOfDay(Date.now())));

    return (
        <SafeAreaView style={styles.container}>
            <View style={styles.header}>
                <TouchableOpacity onPress={() => router.back()} style={styles.headerIcon}>
                    <ChevronLeft size={26} color="#374151" />
                </TouchableOpacity>
                <View style={styles.headerTitleContainer}>
                    <Text style={styles.headerTitle}>Statistik</Text>
                </View>
                <View style={styles.headerIcon} />
            </View>

            {/* Filterleiste */}
            <View style={styles.filterBar}>
                <View style={styles.segment}>
                    <TouchableOpacity
                        style={[styles.segmentBtn, mode === 'range' && styles.segmentBtnActive]}
                        onPress={() => setMode('range')}
                    >
                        <Text style={[styles.segmentText, mode === 'range' && styles.segmentTextActive]}>Zeitraum</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                        style={[styles.segmentBtn, mode === 'day' && styles.segmentBtnActive]}
                        onPress={() => setMode('day')}
                    >
                        <Text style={[styles.segmentText, mode === 'day' && styles.segmentTextActive]}>Tag</Text>
                    </TouchableOpacity>
                </View>

                {mode === 'range' ? (
                    <View style={styles.chips}>
                        {(['7', '30', '90', 'all'] as RangePreset[]).map((p) => (
                            <TouchableOpacity
                                key={p}
                                style={[styles.chip, preset === p && styles.chipActive]}
                                onPress={() => setPreset(p)}
                            >
                                <Text style={[styles.chipText, preset === p && styles.chipTextActive]}>
                                    {p === 'all' ? 'Alles' : `${p} Tage`}
                                </Text>
                            </TouchableOpacity>
                        ))}
                    </View>
                ) : (
                    <View style={styles.dayStepper}>
                        <TouchableOpacity onPress={goPrevDay} style={styles.stepBtn}>
                            <ChevronLeft size={22} color="#0ea5e9" />
                        </TouchableOpacity>
                        <Text style={styles.dayLabel}>{formatDate(day)}</Text>
                        <TouchableOpacity
                            onPress={goNextDay}
                            style={styles.stepBtn}
                            disabled={day >= startOfDay(Date.now())}
                        >
                            <ChevronRight size={22} color={day >= startOfDay(Date.now()) ? '#cbd5e1' : '#0ea5e9'} />
                        </TouchableOpacity>
                    </View>
                )}
            </View>

            <ScrollView contentContainerStyle={styles.scroll}>
                {loading ? (
                    <Text style={styles.muted}>Lade Daten…</Text>
                ) : allMsgs.length === 0 ? (
                    <View style={styles.empty}>
                        <BarChart3 size={56} color="#cbd5e1" />
                        <Text style={styles.emptyTitle}>Noch keine Daten</Text>
                        <Text style={styles.emptySubtitle}>
                            Sobald du Nachrichten verfasst, erscheinen hier deine Statistiken.
                        </Text>
                    </View>
                ) : (
                    <>
                        {/* ---- Aktivität ---- */}
                        <Text style={styles.sectionTitle}>Aktivität</Text>
                        <View style={styles.cardRow}>
                            <StatCard label="Nachrichten" value={totals.totalMessages} />
                            <StatCard label="Aktive Tage" value={totals.activeDays} />
                        </View>
                        <View style={styles.cardRow}>
                            <StatCard label="Serie (Tage)" value={totals.currentStreak} />
                            <StatCard label="Ø Wörter / Nachricht" value={totals.avgWords} />
                        </View>
                        <View style={styles.cardRow}>
                            <StatCard label="Wörter gesamt" value={totals.totalWords} />
                            <StatCard label="Zeichen gesamt" value={totals.totalChars} />
                        </View>

                        {mode === 'range' && timeSeries.length > 0 && (
                            <ChartCard title={rangeDays > 31 ? 'Nachrichten pro Woche' : 'Nachrichten pro Tag'}>
                                <BarChart
                                    data={{
                                        labels: thinLabels(timeSeries.map((b) => b.label)),
                                        datasets: [{ data: timeSeries.map((b) => b.count) }],
                                    }}
                                    width={chartWidth}
                                    height={220}
                                    chartConfig={chartConfig}
                                    fromZero
                                    yAxisLabel=""
                                    yAxisSuffix=""
                                    showValuesOnTopOfBars={timeSeries.length <= 14}
                                    style={styles.chart}
                                />
                            </ChartCard>
                        )}

                        {totals.totalMessages > 0 && (
                            <ChartCard title="Tageszeit">
                                <BarChart
                                    data={{
                                        labels: todBuckets.map((b) => b.label),
                                        datasets: [{ data: todBuckets.map((b) => b.count) }],
                                    }}
                                    width={chartWidth}
                                    height={200}
                                    chartConfig={chartConfig}
                                    fromZero
                                    yAxisLabel=""
                                    yAxisSuffix=""
                                    showValuesOnTopOfBars
                                    style={styles.chart}
                                />
                            </ChartCard>
                        )}

                        {/* ---- Kommunikation (AAC) ---- */}
                        <Text style={styles.sectionTitle}>Kommunikation</Text>
                        {(totals.sendCount + totals.saveCount) > 0 && (
                            <ChartCard title="Gesprochen vs. gespeichert">
                                <PieChart
                                    data={[
                                        {
                                            name: 'Gesprochen',
                                            count: totals.sendCount,
                                            color: '#0ea5e9',
                                            legendFontColor: '#374151',
                                            legendFontSize: 13,
                                        },
                                        {
                                            name: 'Gespeichert',
                                            count: totals.saveCount,
                                            color: '#10b981',
                                            legendFontColor: '#374151',
                                            legendFontSize: 13,
                                        },
                                    ]}
                                    width={chartWidth}
                                    height={170}
                                    chartConfig={chartConfig}
                                    accessor="count"
                                    backgroundColor="transparent"
                                    paddingLeft="8"
                                />
                            </ChartCard>
                        )}

                        <View style={styles.cardRow}>
                            <StatCard label="Bearbeitet" value={totals.editedCount} />
                            <StatCard
                                label="Längste Nachricht"
                                value={totals.longest ? `${totals.longest.chars} Z.` : '–'}
                            />
                        </View>

                        <RankList title="Häufigste Sätze" items={phrases} empty="Noch keine Wiederholungen." />
                        <RankList title="Häufigste Wörter" items={words} empty="Noch keine Daten." />

                        {/* ---- TTS / API ---- */}
                        <Text style={styles.sectionTitle}>Sprachausgabe</Text>
                        <View style={styles.cardRow}>
                            <StatCard label="Wiedergaben" value={tts.requests} />
                            <StatCard label="Zeichen synth." value={tts.chars} />
                        </View>
                        <View style={styles.cardRow}>
                            <StatCard label="Sprechzeit (s)" value={tts.durationSec} />
                            <View style={styles.card} />
                        </View>

                        {mode === 'range' && tts.perDay.length > 0 && tts.requests > 0 && (
                            <ChartCard title="Wiedergaben pro Tag">
                                <BarChart
                                    data={{
                                        labels: thinLabels(tts.perDay.map((b) => b.label)),
                                        datasets: [{ data: tts.perDay.map((b) => b.count) }],
                                    }}
                                    width={chartWidth}
                                    height={200}
                                    chartConfig={chartConfig}
                                    fromZero
                                    yAxisLabel=""
                                    yAxisSuffix=""
                                    style={styles.chart}
                                />
                            </ChartCard>
                        )}

                        {audioPerMonth.length > 0 && (
                            <View style={styles.chartCard}>
                                <Text style={styles.chartTitle}>Audio pro Monat (Minuten)</Text>
                                {audioPerMonth.map((m) => (
                                    <View key={m.key} style={styles.rankRow}>
                                        <Text style={styles.rankText}>{m.label}</Text>
                                        <Text style={styles.rankCount}>{m.minutes} min</Text>
                                    </View>
                                ))}
                            </View>
                        )}

                        {/* ---- Cache ---- */}
                        <Text style={styles.sectionTitle}>Audio-Cache</Text>
                        {cacheStats && (
                            <>
                                <View style={styles.cardRow}>
                                    <StatCard label="Einträge" value={cacheStats.entries} />
                                    <StatCard label="Größe (MB)" value={cacheStats.totalSizeMB} />
                                </View>
                                <View style={styles.cardRow}>
                                    <StatCard label="Treffer (gesamt)" value={cacheStats.hits} />
                                    <StatCard label="Trefferquote" value={`${cacheStats.hitRatePct} %`} />
                                </View>
                                <TouchableOpacity style={styles.clearBtn} onPress={handleClearCache}>
                                    <Text style={styles.clearBtnText}>Cache leeren</Text>
                                </TouchableOpacity>
                            </>
                        )}

                        <View style={{ height: 40 }} />
                    </>
                )}
            </ScrollView>
        </SafeAreaView>
    );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
    return (
        <View style={styles.card}>
            <Text style={styles.cardValue}>{value}</Text>
            <Text style={styles.cardLabel}>{label}</Text>
        </View>
    );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>{title}</Text>
            {children}
        </View>
    );
}

function RankList({ title, items, empty }: { title: string; items: { text: string; count: number }[]; empty: string }) {
    return (
        <View style={styles.chartCard}>
            <Text style={styles.chartTitle}>{title}</Text>
            {items.length === 0 ? (
                <Text style={styles.muted}>{empty}</Text>
            ) : (
                items.map((it, i) => (
                    <View key={i} style={styles.rankRow}>
                        <Text style={styles.rankText} numberOfLines={1}>
                            {i + 1}. {it.text}
                        </Text>
                        <Text style={styles.rankCount}>{it.count}×</Text>
                    </View>
                ))
            )}
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

    filterBar: {
        backgroundColor: '#ffffff',
        paddingHorizontal: 16,
        paddingBottom: 12,
        borderBottomWidth: 1,
        borderBottomColor: '#e5e7eb',
    },
    segment: {
        flexDirection: 'row',
        backgroundColor: '#f1f5f9',
        borderRadius: 10,
        padding: 3,
        marginBottom: 12,
    },
    segmentBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },
    segmentBtnActive: { backgroundColor: '#ffffff', elevation: 1, shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 2 },
    segmentText: { fontSize: 15, color: '#64748b', fontWeight: '500' },
    segmentTextActive: { color: '#0ea5e9', fontWeight: '700' },

    chips: { flexDirection: 'row', gap: 8 },
    chip: {
        flex: 1,
        paddingVertical: 8,
        borderRadius: 20,
        borderWidth: 1,
        borderColor: '#e2e8f0',
        alignItems: 'center',
    },
    chipActive: { backgroundColor: '#0ea5e9', borderColor: '#0ea5e9' },
    chipText: { fontSize: 13, color: '#475569' },
    chipTextActive: { color: '#ffffff', fontWeight: '700' },

    dayStepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 16 },
    stepBtn: { padding: 8, borderRadius: 20, backgroundColor: '#f1f5f9' },
    dayLabel: { fontSize: 16, fontWeight: '600', color: '#111827', minWidth: 110, textAlign: 'center' },

    scroll: { padding: 16, alignItems: 'center' },

    sectionTitle: {
        alignSelf: 'flex-start',
        width: '100%',
        maxWidth: 560,
        fontSize: 20,
        fontWeight: '700',
        color: '#0f172a',
        marginTop: 16,
        marginBottom: 12,
    },

    cardRow: { flexDirection: 'row', gap: 12, width: '100%', maxWidth: 560, marginBottom: 12 },
    card: {
        flex: 1,
        backgroundColor: '#ffffff',
        borderRadius: 14,
        padding: 16,
        borderWidth: 1,
        borderColor: '#eef2f7',
    },
    cardValue: { fontSize: 26, fontWeight: '800', color: '#0ea5e9' },
    cardLabel: { fontSize: 13, color: '#64748b', marginTop: 4 },

    chartCard: {
        width: '100%',
        maxWidth: 560,
        backgroundColor: '#ffffff',
        borderRadius: 14,
        padding: 16,
        borderWidth: 1,
        borderColor: '#eef2f7',
        marginBottom: 12,
    },
    chartTitle: { fontSize: 15, fontWeight: '600', color: '#334155', marginBottom: 8 },
    chart: { borderRadius: 8, marginLeft: -8 },

    rankRow: {
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: '#f1f5f9',
        gap: 12,
    },
    rankText: { flex: 1, fontSize: 15, color: '#1e293b' },
    rankCount: { fontSize: 14, fontWeight: '700', color: '#0ea5e9' },

    muted: { color: '#94a3b8', fontSize: 14, paddingVertical: 8 },
    note: {
        width: '100%',
        maxWidth: 560,
        fontSize: 12,
        color: '#94a3b8',
        lineHeight: 18,
        fontStyle: 'italic',
        marginTop: 4,
    },

    empty: { alignItems: 'center', paddingTop: 80, gap: 12 },
    emptyTitle: { fontSize: 20, fontWeight: '700', color: '#475569' },
    emptySubtitle: { fontSize: 15, color: '#94a3b8', textAlign: 'center', paddingHorizontal: 30 },

    clearBtn: {
        width: '100%',
        maxWidth: 560,
        backgroundColor: '#fff1f2',
        borderRadius: 12,
        borderWidth: 1,
        borderColor: '#fecdd3',
        paddingVertical: 14,
        alignItems: 'center',
        marginBottom: 12,
    },
    clearBtnText: { fontSize: 15, fontWeight: '600', color: '#e11d48' },
});