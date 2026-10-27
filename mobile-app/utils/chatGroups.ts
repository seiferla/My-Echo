import { Chat } from './types';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Groups chats for the sidebar: pinned first, then by age. The keys are the
 * German group titles, in display order. Ages count back from `now`
 * (e.g. "Heute" = the last 24 hours, not the calendar day).
 */
export function groupChatsByDate(chats: Chat[], now = Date.now()): Record<string, Chat[]> {
    const groups: Record<string, Chat[]> = {
        'Gepinnt': [],
        'Heute': [],
        'Gestern': [],
        'Letzte 7 Tage': [],
        'Letzte 30 Tage': [],
        'Älter': [],
    };

    chats.forEach(chat => {
        if (chat.pinned) {
            groups['Gepinnt'].push(chat);
            return;
        }
        const diff = now - chat.timestamp;
        if (diff < DAY_MS) {
            groups['Heute'].push(chat);
        } else if (diff < 2 * DAY_MS) {
            groups['Gestern'].push(chat);
        } else if (diff < 7 * DAY_MS) {
            groups['Letzte 7 Tage'].push(chat);
        } else if (diff < 30 * DAY_MS) {
            groups['Letzte 30 Tage'].push(chat);
        } else {
            groups['Älter'].push(chat);
        }
    });

    return groups;
}
