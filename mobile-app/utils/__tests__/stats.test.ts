import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import {
    computeStreak,
    computeTotals,
    filterByRange,
    flattenMessages,
    messagesPerDay,
    messagesPerWeek,
    summarizeTts,
    syncAndLoadTtsStats,
    timeOfDayDistribution,
    topPhrases,
    topWords,
    ttsAudioPerMonth,
    FlatMessage,
} from '../stats';
import { getTtsStats, syncTtsStats, TtsStats } from '../ttsLog';
import { Chat } from '../types';

// Only the storage and network parts of ttsLog are replaced. dayKey has the same
// logic as the real one (local date as YYYY-MM-DD), so these tests need no storage mock.
jest.mock('../ttsLog', () => ({
    getTtsStats: jest.fn(),
    syncTtsStats: jest.fn(),
    dayKey: (ts: number) => {
        const d = new Date(ts);
        const m = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${d.getFullYear()}-${m}-${day}`;
    },
}));

const mockGetTtsStats = jest.mocked(getTtsStats);
const mockSyncTtsStats = jest.mocked(syncTtsStats);

// Local time, so the tests do not depend on the time zone of the machine.
const at = (y: number, month: number, day: number, hour = 12) => new Date(y, month - 1, day, hour).getTime();

function flat(ts: number, content: string, extra: Partial<FlatMessage> = {}): FlatMessage {
    return {
        ts,
        content,
        chars: content.length,
        words: content.split(/\s+/).filter(Boolean).length,
        via: 'send',
        editCount: 0,
        ...extra,
    };
}

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(at(2026, 11, 25));
});

afterEach(() => {
    jest.useRealTimers();
    jest.resetAllMocks();
});

describe('flattenMessages', () => {
    const chat = (messages: Chat['messages'], timestamp = at(2026, 11, 1)): Chat => ({
        id: 'c',
        title: 't',
        timestamp,
        messages,
    });

    it('keeps only user messages and drops empty ones', () => {
        const result = flattenMessages([
            chat([
                { id: '1', role: 'user', content: 'Hallo' },
                { id: '2', role: 'assistant', content: 'Antwort' },
                { id: '3', role: 'user', content: '   ' },
            ]),
        ]);

        expect(result.map((m) => m.content)).toEqual(['Hallo']);
    });

    it('trims the text and counts characters and words', () => {
        const [m] = flattenMessages([chat([{ id: '1', role: 'user', content: '  Guten  Morgen  ' }])]);

        expect(m).toMatchObject({ content: 'Guten  Morgen', chars: 13, words: 2 });
    });

    it('fills in defaults for old data', () => {
        const [m] = flattenMessages([chat([{ id: '1', role: 'user', content: 'Hallo' }], 555)]);

        expect(m).toEqual({ ts: 555, content: 'Hallo', chars: 5, words: 1, via: 'send', editCount: 0 });
    });

    it('uses the message values when present', () => {
        const [m] = flattenMessages([
            chat([{ id: '1', role: 'user', content: 'Hallo', timestamp: 99, via: 'save', editCount: 2 }]),
        ]);

        expect(m).toMatchObject({ ts: 99, via: 'save', editCount: 2 });
    });

    it('sorts all chats by time', () => {
        const result = flattenMessages([
            chat([{ id: '1', role: 'user', content: 'spät', timestamp: 300 }]),
            chat([{ id: '2', role: 'user', content: 'früh', timestamp: 100 }]),
        ]);

        expect(result.map((m) => m.content)).toEqual(['früh', 'spät']);
    });
});

describe('filterByRange', () => {
    it('includes both ends of the range', () => {
        const msgs = [flat(1, 'a'), flat(2, 'b'), flat(3, 'c'), flat(4, 'd')];

        expect(filterByRange(msgs, 2, 3).map((m) => m.content)).toEqual(['b', 'c']);
    });
});

describe('messagesPerDay', () => {
    it('returns every day of the range, also days with 0', () => {
        const msgs = [flat(at(2026, 11, 23), 'a'), flat(at(2026, 11, 23, 18), 'b'), flat(at(2026, 11, 25), 'c')];

        const result = messagesPerDay(msgs, at(2026, 11, 23), at(2026, 11, 25));

        expect(result).toEqual([
            { key: '2026-11-23', label: '23.11', count: 2 },
            { key: '2026-11-24', label: '24.11', count: 0 },
            { key: '2026-11-25', label: '25.11', count: 1 },
        ]);
    });

    it('works across a month change and for a single day', () => {
        const range = messagesPerDay([], at(2026, 11, 30), at(2026, 12, 2));
        expect(range.map((b) => b.label)).toEqual(['30.11', '01.12', '02.12']);

        expect(messagesPerDay([], at(2026, 11, 5), at(2026, 11, 5, 20))).toHaveLength(1);
    });
});

describe('messagesPerWeek', () => {
    it('groups by ISO week, also over the year boundary', () => {
        const msgs = [
            flat(at(2025, 12, 29), 'a'), // Monday of ISO week 1 of 2026
            flat(at(2026, 1, 1), 'b'),   // Thursday, same week
            flat(at(2026, 1, 5), 'c'),   // next week
        ];

        expect(messagesPerWeek(msgs)).toEqual([
            { key: '2026-W01', label: 'KW01', count: 2 },
            { key: '2026-W02', label: 'KW02', count: 1 },
        ]);
    });

    it('assigns the end of 2026 to week 53 of 2026', () => {
        const result = messagesPerWeek([flat(at(2027, 1, 1), 'a')]); // Friday

        expect(result).toEqual([{ key: '2026-W53', label: 'KW53', count: 1 }]);
    });

    it('sorts the weeks, whatever the order of the messages', () => {
        const result = messagesPerWeek([flat(at(2026, 3, 10), 'a'), flat(at(2026, 2, 10), 'b')]);

        expect(result.map((b) => b.key)).toEqual(['2026-W07', '2026-W11']);
    });
});

describe('timeOfDayDistribution', () => {
    it('puts hours into six 4-hour blocks', () => {
        const hours = [0, 3, 4, 12, 15, 23];
        const msgs = hours.map((h) => flat(at(2026, 11, 20, h), 'x'));

        const result = timeOfDayDistribution(msgs);

        expect(result.map((b) => b.label)).toEqual(['0–4', '4–8', '8–12', '12–16', '16–20', '20–24']);
        expect(result.map((b) => b.count)).toEqual([2, 1, 0, 2, 0, 1]);
    });
});

describe('topPhrases', () => {
    it('counts the same text case- and space-insensitively and keeps the first spelling', () => {
        const msgs = [
            flat(1, 'Ich habe Durst'),
            flat(2, 'ich  habe durst'),
            flat(3, 'ICH HABE DURST'),
            flat(4, 'Danke'),
            flat(5, 'danke'),
        ];

        expect(topPhrases(msgs)).toEqual([
            { text: 'Ich habe Durst', count: 3 },
            { text: 'Danke', count: 2 },
        ]);
    });

    it('ignores texts that appear only once and respects the limit', () => {
        const msgs = ['a', 'a', 'b', 'b', 'c', 'c', 'd'].map((t, i) => flat(i, t));

        expect(topPhrases(msgs, 2)).toHaveLength(2);
        expect(topPhrases(msgs).map((p) => p.text)).not.toContain('d');
    });
});

describe('topWords', () => {
    it('drops stop words, short words and punctuation, and ranks by count', () => {
        const msgs = [
            flat(1, 'Ich möchte einen Kaffee, bitte!'),
            flat(2, 'Noch ein Kaffee mit Milch'),
            flat(3, 'Kaffee oder Tee?'),
        ];

        const result = topWords(msgs);

        expect(result[0]).toEqual({ text: 'kaffee', count: 3 });
        const words = result.map((r) => r.text);
        expect(words).toEqual(expect.arrayContaining(['möchte', 'bitte', 'milch', 'tee']));
        expect(words).not.toEqual(expect.arrayContaining(['ich', 'einen', 'ein', 'mit', 'oder', 'noch']));
    });

    it('respects the limit', () => {
        const msgs = [flat(1, 'alpha beta gamma delta')];

        expect(topWords(msgs, 2)).toHaveLength(2);
    });
});

describe('computeStreak', () => {
    const days = (...d: number[]) => new Set(d.map((day) => `2026-11-${String(day).padStart(2, '0')}`));

    it('is 0 without active days', () => {
        expect(computeStreak(new Set())).toBe(0);
    });

    it('counts the days in a row up to today', () => {
        expect(computeStreak(days(23, 24, 25))).toBe(3);
    });

    it('still counts when the last active day was yesterday', () => {
        expect(computeStreak(days(23, 24))).toBe(2);
    });

    it('stops at the first gap', () => {
        expect(computeStreak(days(20, 21, 24, 25))).toBe(2);
    });

    it('is 0 when neither today nor yesterday was active', () => {
        expect(computeStreak(days(20, 21, 22))).toBe(0);
    });
});

describe('computeTotals', () => {
    it('returns zeros for no messages', () => {
        expect(computeTotals([])).toEqual({
            totalMessages: 0,
            totalWords: 0,
            totalChars: 0,
            avgChars: 0,
            avgWords: 0,
            activeDays: 0,
            currentStreak: 0,
            sendCount: 0,
            saveCount: 0,
            editedCount: 0,
            longest: null,
        });
    });

    it('sums up and averages', () => {
        const longest = flat(at(2026, 11, 24), 'ein ganz langer Satz', { via: 'save' });
        const msgs = [
            flat(at(2026, 11, 24), 'Hallo', { editCount: 1 }),
            longest,
            flat(at(2026, 11, 25), 'Danke schön'),
        ];

        const totals = computeTotals(msgs);

        expect(totals).toMatchObject({
            totalMessages: 3,
            totalWords: 1 + 4 + 2,
            totalChars: 5 + 20 + 11,
            avgChars: 12, // 36 / 3
            avgWords: 2.3, // 7 / 3, one decimal
            activeDays: 2,
            currentStreak: 2,
            sendCount: 2,
            saveCount: 1,
            editedCount: 1,
        });
        expect(totals.longest).toBe(longest);
    });
});

describe('TTS stats', () => {
    const stats: TtsStats = {
        '2026-11-23': { requests: 2, chars: 50, durationMs: 4_000 },
        '2026-11-25': { requests: 1, chars: 30, durationMs: 2_600 },
        '2026-10-30': { requests: 5, chars: 500, durationMs: 90_000 },
    };

    it('syncs before it reads', async () => {
        const order: string[] = [];
        mockSyncTtsStats.mockImplementation(async () => {
            order.push('sync');
        });
        mockGetTtsStats.mockImplementation(async () => {
            order.push('get');
            return stats;
        });

        expect(await syncAndLoadTtsStats()).toBe(stats);
        expect(order).toEqual(['sync', 'get']);
    });

    it('summarizes only the days in the range, with 0 for empty days', () => {
        const result = summarizeTts(stats, at(2026, 11, 23), at(2026, 11, 25));

        expect(result).toMatchObject({ requests: 3, chars: 80, durationSec: 7 }); // 6.6 s → 7 s
        expect(result.perDay).toEqual([
            { key: '2026-11-23', label: '23.11', count: 2 },
            { key: '2026-11-24', label: '24.11', count: 0 },
            { key: '2026-11-25', label: '25.11', count: 1 },
        ]);
    });

    it('sums the audio minutes per month in order', () => {
        expect(ttsAudioPerMonth(stats)).toEqual([
            { key: '2026-10', label: 'Okt 2026', minutes: 1.5 },
            { key: '2026-11', label: 'Nov 2026', minutes: 0.1 },
        ]);
    });

    it('uses German month names', () => {
        const result = ttsAudioPerMonth({
            '2026-03-01': { requests: 1, chars: 1, durationMs: 60_000 },
            '2026-05-01': { requests: 1, chars: 1, durationMs: 60_000 },
            '2026-12-01': { requests: 1, chars: 1, durationMs: 60_000 },
        });

        expect(result.map((m) => m.label)).toEqual(['Mär 2026', 'Mai 2026', 'Dez 2026']);
    });

    it('returns nothing without data', () => {
        expect(ttsAudioPerMonth({})).toEqual([]);
    });
});
