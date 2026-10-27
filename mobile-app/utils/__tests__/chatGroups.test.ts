import { describe, expect, it } from '@jest/globals';
import { groupChatsByDate } from '../chatGroups';
import { Chat } from '../types';

const NOW = Date.UTC(2026, 9, 27, 12, 0, 0);
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

function chat(id: string, ageMs: number, pinned = false): Chat {
    return { id, title: id, timestamp: NOW - ageMs, messages: [], pinned };
}

const ids = (chats: Chat[]) => chats.map((c) => c.id);

describe('groupChatsByDate', () => {
    it('puts each chat into the group of its age', () => {
        const groups = groupChatsByDate(
            [
                chat('today', 2 * HOUR),
                chat('yesterday', DAY + HOUR),
                chat('week', 3 * DAY),
                chat('month', 10 * DAY),
                chat('older', 40 * DAY),
            ],
            NOW,
        );

        expect(ids(groups['Heute'])).toEqual(['today']);
        expect(ids(groups['Gestern'])).toEqual(['yesterday']);
        expect(ids(groups['Letzte 7 Tage'])).toEqual(['week']);
        expect(ids(groups['Letzte 30 Tage'])).toEqual(['month']);
        expect(ids(groups['Älter'])).toEqual(['older']);
    });

    it('puts pinned chats only into "Gepinnt", whatever their age', () => {
        const groups = groupChatsByDate([chat('old-pinned', 40 * DAY, true)], NOW);

        expect(ids(groups['Gepinnt'])).toEqual(['old-pinned']);
        expect(ids(groups['Älter'])).toEqual([]);
    });

    it('keeps the display order of the groups', () => {
        expect(Object.keys(groupChatsByDate([], NOW))).toEqual([
            'Gepinnt', 'Heute', 'Gestern', 'Letzte 7 Tage', 'Letzte 30 Tage', 'Älter',
        ]);
    });
});
