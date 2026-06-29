import { storage } from './storage';
import { getTtsStats, dayKey, TtsStats } from './ttsLog';

export type { TtsStats } from './ttsLog';

/**
 * Auswertungslogik für die Statistikseite.
 * Alle Nachrichten-Statistiken werden aus dem lokal gespeicherten
 * 'myEchoChats'-Eintrag berechnet, die TTS-Statistiken aus 'myEchoTtsStats'.
 */

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
    timestamp?: number;
    via?: 'send' | 'save';
    editCount?: number;
}

export interface Chat {
    id: string;
    title: string;
    messages: ChatMessage[];
    timestamp: number;
    pinned?: boolean;
}

/** Eine einzelne geäußerte (vom Nutzer verfasste) Nachricht, flach. */
export interface FlatMessage {
    ts: number;
    content: string;
    chars: number;
    words: number;
    via: 'send' | 'save';
    editCount: number;
}

const CHATS_KEY = 'myEchoChats';

// Kleine deutsche Stopwortliste für die Wort-Auswertung.
const STOPWORDS = new Set([
    'der', 'die', 'das', 'und', 'ist', 'ich', 'du', 'er', 'sie', 'es', 'wir',
    'ihr', 'ein', 'eine', 'einen', 'einem', 'einer', 'zu', 'mit', 'auf', 'für',
    'von', 'im', 'in', 'am', 'an', 'den', 'dem', 'des', 'mir', 'mich', 'dich',
    'dir', 'mein', 'dein', 'auch', 'nicht', 'noch', 'nur', 'mal', 'so', 'wie',
    'was', 'wer', 'wo', 'da', 'dann', 'aber', 'oder', 'als', 'bei', 'aus',
    'hat', 'habe', 'haben', 'bin', 'bist', 'sind', 'war', 'wird', 'werden',
    'kann', 'will', 'man', 'schon', 'sehr', 'mehr', 'hier', 'doch', 'ja', 'nein',
]);

export async function loadChats(): Promise<Chat[]> {
    const raw = await storage.getItem(CHATS_KEY);
    if (!raw) return [];
    try {
        return JSON.parse(raw) as Chat[];
    } catch {
        return [];
    }
}

/**
 * Flacht alle vom Nutzer verfassten Nachrichten zu einer Liste ab.
 * Fehlende Felder (Altdaten) werden sinnvoll vorbelegt:
 * - timestamp: fällt auf den Chat-Zeitstempel zurück
 * - via: 'send' angenommen
 */
export function flattenMessages(chats: Chat[]): FlatMessage[] {
    const out: FlatMessage[] = [];
    for (const chat of chats) {
        for (const m of chat.messages) {
            if (m.role !== 'user') continue;
            const content = (m.content ?? '').trim();
            if (!content) continue;
            out.push({
                ts: m.timestamp ?? chat.timestamp,
                content,
                chars: content.length,
                words: content.split(/\s+/).filter(Boolean).length,
                via: m.via ?? 'send',
                editCount: m.editCount ?? 0,
            });
        }
    }
    return out.sort((a, b) => a.ts - b.ts);
}

export function filterByRange(msgs: FlatMessage[], from: number, to: number): FlatMessage[] {
    return msgs.filter((m) => m.ts >= from && m.ts <= to);
}

// ---- Zeit-Aggregationen ----

export interface TimeBucket {
    label: string; // Achsenbeschriftung
    key: string;   // eindeutiger Schlüssel
    count: number;
}

/** Nachrichten pro Tag über den gegebenen Zeitraum (lückenlos inkl. Null-Tage). */
export function messagesPerDay(msgs: FlatMessage[], from: number, to: number): TimeBucket[] {
    const counts: Record<string, number> = {};
    for (const m of msgs) {
        const k = dayKey(m.ts);
        counts[k] = (counts[k] ?? 0) + 1;
    }
    const buckets: TimeBucket[] = [];
    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(0, 0, 0, 0);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const k = dayKey(d.getTime());
        buckets.push({
            key: k,
            label: `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`,
            count: counts[k] ?? 0,
        });
    }
    return buckets;
}

/** ISO-Kalenderwoche eines Datums. */
function isoWeek(d: Date): { year: number; week: number } {
    const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const dayNum = date.getUTCDay() || 7;
    date.setUTCDate(date.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return { year: date.getUTCFullYear(), week };
}

/** Nachrichten pro Kalenderwoche. */
export function messagesPerWeek(msgs: FlatMessage[]): TimeBucket[] {
    const counts: Record<string, number> = {};
    const order: string[] = [];
    for (const m of msgs) {
        const { year, week } = isoWeek(new Date(m.ts));
        const k = `${year}-W${String(week).padStart(2, '0')}`;
        if (counts[k] === undefined) order.push(k);
        counts[k] = (counts[k] ?? 0) + 1;
    }
    order.sort();
    return order.map((k) => ({ key: k, label: `KW${k.split('W')[1]}`, count: counts[k] }));
}

/** Verteilung über den Tag, in 6 Vier-Stunden-Blöcken. */
export function timeOfDayDistribution(msgs: FlatMessage[]): TimeBucket[] {
    const labels = ['0–4', '4–8', '8–12', '12–16', '16–20', '20–24'];
    const counts = new Array(6).fill(0);
    for (const m of msgs) {
        const h = new Date(m.ts).getHours();
        counts[Math.floor(h / 4)] += 1;
    }
    return labels.map((label, i) => ({ key: label, label, count: counts[i] }));
}

// ---- Inhalts-Aggregationen (AAC) ----

export interface Ranked {
    text: string;
    count: number;
}

/** Häufigste komplette Sätze/Nachrichten (Kandidaten für Schnellzugriffe). */
export function topPhrases(msgs: FlatMessage[], n = 10): Ranked[] {
    const counts: Record<string, { text: string; count: number }> = {};
    for (const m of msgs) {
        const norm = m.content.toLowerCase().replace(/\s+/g, ' ').trim();
        if (!norm) continue;
        if (!counts[norm]) counts[norm] = { text: m.content, count: 0 };
        counts[norm].count += 1;
    }
    return Object.values(counts)
        .filter((c) => c.count > 1)
        .sort((a, b) => b.count - a.count)
        .slice(0, n);
}

/** Häufigste Einzelwörter (ohne Stopwörter). */
export function topWords(msgs: FlatMessage[], n = 10): Ranked[] {
    const counts: Record<string, number> = {};
    for (const m of msgs) {
        const words = m.content
            .toLowerCase()
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .split(/\s+/)
            .filter((w) => w.length > 2 && !STOPWORDS.has(w));
        for (const w of words) counts[w] = (counts[w] ?? 0) + 1;
    }
    return Object.entries(counts)
        .map(([text, count]) => ({ text, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, n);
}

// ---- Kennzahlen ----

export interface Totals {
    totalMessages: number;
    totalWords: number;
    totalChars: number;
    avgChars: number;
    avgWords: number;
    activeDays: number;
    currentStreak: number;
    sendCount: number;
    saveCount: number;
    editedCount: number;
    longest: FlatMessage | null;
}

export function computeTotals(msgs: FlatMessage[]): Totals {
    const totalMessages = msgs.length;
    const totalWords = msgs.reduce((s, m) => s + m.words, 0);
    const totalChars = msgs.reduce((s, m) => s + m.chars, 0);
    const days = new Set(msgs.map((m) => dayKey(m.ts)));
    let sendCount = 0;
    let saveCount = 0;
    let editedCount = 0;
    let longest: FlatMessage | null = null;
    for (const m of msgs) {
        if (m.via === 'save') saveCount += 1;
        else sendCount += 1;
        if (m.editCount > 0) editedCount += 1;
        if (!longest || m.chars > longest.chars) longest = m;
    }
    return {
        totalMessages,
        totalWords,
        totalChars,
        avgChars: totalMessages ? Math.round(totalChars / totalMessages) : 0,
        avgWords: totalMessages ? Math.round((totalWords / totalMessages) * 10) / 10 : 0,
        activeDays: days.size,
        currentStreak: computeStreak(days),
        sendCount,
        saveCount,
        editedCount,
        longest,
    };
}

/** Längste ununterbrochene Tagesserie, die bis heute (oder gestern) reicht. */
export function computeStreak(activeDays: Set<string>): number {
    if (activeDays.size === 0) return 0;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    // Erlaube Start heute oder gestern, damit die Serie nicht direkt um
    // Mitternacht "bricht", bevor man getippt hat.
    if (!activeDays.has(dayKey(d.getTime()))) {
        d.setDate(d.getDate() - 1);
        if (!activeDays.has(dayKey(d.getTime()))) return 0;
    }
    let streak = 0;
    while (activeDays.has(dayKey(d.getTime()))) {
        streak += 1;
        d.setDate(d.getDate() - 1);
    }
    return streak;
}

// ---- TTS / API ----

export interface TtsSummary {
    requests: number;
    chars: number;
    durationSec: number;
    perDay: TimeBucket[];
}

export async function loadTtsStats(): Promise<TtsStats> {
    return getTtsStats();
}

export function summarizeTts(stats: TtsStats, from: number, to: number): TtsSummary {
    let requests = 0;
    let chars = 0;
    let durationMs = 0;
    const perDay: TimeBucket[] = [];

    const start = new Date(from);
    start.setHours(0, 0, 0, 0);
    const end = new Date(to);
    end.setHours(0, 0, 0, 0);
    for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
        const k = dayKey(d.getTime());
        const bucket = stats[k];
        const r = bucket?.requests ?? 0;
        requests += r;
        chars += bucket?.chars ?? 0;
        durationMs += bucket?.durationMs ?? 0;
        perDay.push({
            key: k,
            label: `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}`,
            count: r,
        });
    }
    return { requests, chars, durationSec: Math.round(durationMs / 1000), perDay };
}

export interface MonthAudio {
    key: string;   // 'YYYY-MM'
    label: string; // z.B. 'Jun 2026'
    minutes: number;
}

const MONTH_LABELS = [
    'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
    'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez',
];

/**
 * Erzeugte Audio-Minuten pro Kalendermonat, aufsummiert aus den
 * TTS-Tagesdaten (`durationMs`). Misst die abgespielte Sprechzeit — bei
 * Cache-Miss inkl. der Download-Zeit, also eine gute Näherung der Audiolänge.
 */
export function ttsAudioPerMonth(stats: TtsStats): MonthAudio[] {
    const byMonth: Record<string, number> = {};
    for (const [day, bucket] of Object.entries(stats)) {
        const month = day.slice(0, 7); // 'YYYY-MM'
        byMonth[month] = (byMonth[month] ?? 0) + (bucket?.durationMs ?? 0);
    }
    return Object.keys(byMonth)
        .sort()
        .map((key) => {
            const [y, m] = key.split('-');
            return {
                key,
                label: `${MONTH_LABELS[Number(m) - 1]} ${y}`,
                minutes: Math.round((byMonth[key] / 60_000) * 10) / 10,
            };
        });
}
