import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { act, renderHook } from '@testing-library/react-native';
import { useChats } from '../useChats';
import type { Chat, ChatMessage } from '../../utils/types';

// ---- Fakes ----

type StartResult = { chats: Chat[]; later: Promise<Chat[] | null> | null };

const mockLoadChatsForStart = jest.fn<() => Promise<StartResult>>();
const mockPushChat = jest.fn<(chat: Chat) => Promise<void>>();
const mockDeleteChatRemote = jest.fn<(id: string) => Promise<void>>();
const mockPersistLocal = jest.fn<(chats: Chat[]) => Promise<void>>();

// mergeChats is the real function, so the late merge test is realistic.
jest.mock('../../utils/chatSync', () => ({
    loadChatsForStart: () => mockLoadChatsForStart(),
    mergeChats: jest.requireActual<typeof import('../../utils/chatSync')>('../../utils/chatSync').mergeChats,
    pushChat: (chat: Chat) => mockPushChat(chat),
    deleteChatRemote: (id: string) => mockDeleteChatRemote(id),
    persistLocal: (chats: Chat[]) => mockPersistLocal(chats),
}));

// ---- Helpers ----

// 12:00 local time, so "earlier day" is safe in every time zone.
const NOW = new Date(2026, 10, 26, 12, 0, 0).getTime();
const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

function message(id: string, content: string): ChatMessage {
    return { id, role: 'user', content };
}

function chat(id: string, timestamp: number, messages: ChatMessage[] = []): Chat {
    return { id, title: `Title ${id}`, messages, timestamp };
}

/** A promise the test resolves by hand, to control when the backend answers. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

/** Starts the hook with these chats and waits until the start is finished. */
async function renderChats(chats: Chat[], later: Promise<Chat[] | null> | null = null) {
    mockLoadChatsForStart.mockResolvedValue({ chats, later });
    const view = await renderHook(() => useChats());
    await act(async () => {});
    return view;
}

function lastSaved(): Chat[] {
    const calls = mockPersistLocal.mock.calls;
    return calls[calls.length - 1][0];
}

function titles(chats: Chat[]): string[] {
    return chats.map((c) => c.title);
}

beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockLoadChatsForStart.mockReset();
    mockPushChat.mockReset().mockResolvedValue(undefined);
    mockDeleteChatRemote.mockReset().mockResolvedValue(undefined);
    mockPersistLocal.mockReset().mockResolvedValue(undefined);
});

afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
});

// ---- Tests ----

describe('start without chats', () => {
    it('creates one empty welcome chat and selects it', async () => {
        const { result } = await renderChats([]);

        expect(result.current.chats).toHaveLength(1);
        expect(result.current.chats[0]).toMatchObject({ id: '1', title: 'Neuer Chat', messages: [] });
        expect(result.current.currentChatId).toBe('1');
        expect(result.current.currentChat?.id).toBe('1');
    });

    it('pushes the welcome chat to the backend', async () => {
        await renderChats([]);

        expect(mockPushChat).toHaveBeenCalledWith(expect.objectContaining({ id: '1', title: 'Neuer Chat' }));
    });
});

describe('start with chats from today', () => {
    it('loads the chats and selects the first one', async () => {
        const stored = [chat('b', NOW - 1000), chat('a', NOW - 5000)];

        const { result } = await renderChats(stored);

        expect(result.current.chats).toEqual(stored);
        expect(result.current.currentChatId).toBe('b');
    });

    it('does not add a new chat', async () => {
        const { result } = await renderChats([chat('b', NOW - 1000)]);

        expect(result.current.chats).toHaveLength(1);
    });
});

describe('start on a new day', () => {
    it('adds an empty chat at the front and selects it', async () => {
        const old = chat('old', NOW - TWO_DAYS);

        const { result } = await renderChats([old]);

        expect(result.current.chats).toHaveLength(2);
        expect(result.current.chats[0]).toMatchObject({ title: 'Neuer Chat', messages: [] });
        expect(result.current.chats[1]).toEqual(old);
        expect(result.current.currentChatId).toBe(result.current.chats[0].id);
    });

    it('pushes the new chat', async () => {
        const { result } = await renderChats([chat('old', NOW - TWO_DAYS)]);

        expect(mockPushChat).toHaveBeenCalledWith(result.current.chats[0]);
    });
});

describe('late backend result', () => {
    it('merges the backend chats into the current list', async () => {
        const later = deferred<Chat[] | null>();
        const { result } = await renderChats([chat('a', NOW - 1000)], later.promise);

        await act(async () => {
            later.resolve([chat('remote', NOW - 2000)]);
        });

        expect(result.current.chats.map((c) => c.id)).toEqual(['a', 'remote']);
    });

    it('keeps a rename made while the backend was slow', async () => {
        const later = deferred<Chat[] | null>();
        const { result } = await renderChats([chat('a', NOW - 1000)], later.promise);
        await act(async () => {
            result.current.renameChat('a', 'My name');
        });

        await act(async () => {
            later.resolve([chat('a', NOW - 1000), chat('remote', NOW - 2000)]);
        });

        expect(result.current.chats.find((c) => c.id === 'a')?.title).toBe('My name');
        expect(result.current.chats.map((c) => c.id)).toEqual(['a', 'remote']);
    });

    it('keeps a message added while the backend was slow', async () => {
        const later = deferred<Chat[] | null>();
        const { result } = await renderChats([chat('a', NOW - 1000)], later.promise);
        await act(async () => {
            result.current.updateChat('a', [message('m1', 'Hello')]);
        });

        await act(async () => {
            later.resolve([chat('a', NOW - 1000)]);
        });

        expect(result.current.chats[0].messages).toHaveLength(1);
    });

    it('changes nothing when the backend result is null', async () => {
        const later = deferred<Chat[] | null>();
        const stored = [chat('a', NOW - 1000)];
        const { result } = await renderChats(stored, later.promise);

        await act(async () => {
            later.resolve(null);
        });

        expect(result.current.chats).toEqual(stored);
    });

    it('ignores a result that arrives after unmount', async () => {
        const later = deferred<Chat[] | null>();
        const { unmount } = await renderChats([chat('a', NOW - 1000)], later.promise);
        const savesBefore = mockPersistLocal.mock.calls.length;

        await unmount();
        await act(async () => {
            later.resolve([chat('remote', NOW - 2000)]);
        });

        expect(console.error).not.toHaveBeenCalled();
        expect(mockPersistLocal).toHaveBeenCalledTimes(savesBefore);
    });

    it('ignores a start result that arrives after unmount', async () => {
        const start = deferred<StartResult>();
        mockLoadChatsForStart.mockReturnValue(start.promise);
        const { unmount } = await renderHook(() => useChats());

        await unmount();
        await act(async () => {
            start.resolve({ chats: [chat('a', NOW)], later: null });
        });

        expect(console.error).not.toHaveBeenCalled();
        expect(mockPersistLocal).not.toHaveBeenCalled();
        expect(mockPushChat).not.toHaveBeenCalled();
    });
});

describe('saving changes', () => {
    it('saves the full list locally after the start', async () => {
        const stored = [chat('b', NOW - 1000), chat('a', NOW - 5000)];

        await renderChats(stored);

        expect(lastSaved()).toEqual(stored);
    });

    it('saves the full list locally after a change', async () => {
        const { result } = await renderChats([chat('b', NOW - 1000), chat('a', NOW - 5000)]);

        await act(async () => {
            result.current.renameChat('a', 'Renamed');
        });

        expect(titles(lastSaved())).toEqual(['Title b', 'Renamed']);
    });

    it('pushes only the current chat after a change', async () => {
        const { result } = await renderChats([chat('b', NOW - 1000), chat('a', NOW - 5000)]);
        mockPushChat.mockClear();

        await act(async () => {
            result.current.pinChat('b');
        });

        expect(mockPushChat).toHaveBeenCalledTimes(1);
        expect(mockPushChat).toHaveBeenCalledWith(expect.objectContaining({ id: 'b', pinned: true }));
    });

    it('pushes the other chat after it is selected and changed', async () => {
        const { result } = await renderChats([chat('b', NOW - 1000), chat('a', NOW - 5000)]);
        await act(async () => {
            result.current.selectChat('a');
        });
        mockPushChat.mockClear();

        await act(async () => {
            result.current.pinChat('a');
        });

        expect(mockPushChat).toHaveBeenCalledTimes(1);
        expect(mockPushChat).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }));
    });
});

describe('createChat', () => {
    it('adds an empty chat at the front and selects it', async () => {
        const old = chat('a', NOW - 1000);
        const { result } = await renderChats([old]);

        await act(async () => {
            result.current.createChat();
        });

        expect(result.current.chats).toHaveLength(2);
        expect(result.current.chats[0]).toMatchObject({ title: 'Neuer Chat', messages: [] });
        expect(result.current.chats[1]).toEqual(old);
        expect(result.current.currentChatId).toBe(result.current.chats[0].id);
    });
});

describe('pinChat', () => {
    it('toggles pinned for that chat only', async () => {
        const { result } = await renderChats([chat('b', NOW - 1000), chat('a', NOW - 5000)]);

        await act(async () => {
            result.current.pinChat('a');
        });
        expect(result.current.chats.map((c) => c.pinned)).toEqual([undefined, true]);

        await act(async () => {
            result.current.pinChat('a');
        });
        expect(result.current.chats.map((c) => c.pinned)).toEqual([undefined, false]);
    });
});

describe('renameChat', () => {
    it('sets the title and marks it as custom', async () => {
        const { result } = await renderChats([chat('a', NOW - 1000)]);

        await act(async () => {
            result.current.renameChat('a', 'Doctor visit');
        });

        expect(result.current.chats[0]).toMatchObject({ title: 'Doctor visit', titleIsCustom: true });
    });
});

describe('updateChat', () => {
    it('sets the messages of that chat only', async () => {
        const { result } = await renderChats([chat('b', NOW - 1000), chat('a', NOW - 5000)]);
        const messages = [message('m1', 'Hello')];

        await act(async () => {
            result.current.updateChat('a', messages);
        });

        expect(result.current.chats[1].messages).toEqual(messages);
        expect(result.current.chats[0].messages).toEqual([]);
    });

    it('takes the title from the first message', async () => {
        const { result } = await renderChats([chat('a', NOW - 1000)]);

        await act(async () => {
            result.current.updateChat('a', [message('m1', 'Hello'), message('m2', 'Second')]);
        });

        expect(result.current.chats[0].title).toBe('Hello');
    });

    it('cuts the title after 30 characters', async () => {
        const { result } = await renderChats([chat('a', NOW - 1000)]);

        await act(async () => {
            result.current.updateChat('a', [message('m1', 'x'.repeat(40))]);
        });

        expect(result.current.chats[0].title).toBe('x'.repeat(30));
    });

    it('uses "Neuer Chat" when there are no messages', async () => {
        const { result } = await renderChats([chat('a', NOW - 1000, [message('m1', 'Hello')])]);

        await act(async () => {
            result.current.updateChat('a', []);
        });

        expect(result.current.chats[0].title).toBe('Neuer Chat');
    });

    it('keeps a custom title', async () => {
        const { result } = await renderChats([chat('a', NOW - 1000)]);
        await act(async () => {
            result.current.renameChat('a', 'My title');
        });

        await act(async () => {
            result.current.updateChat('a', [message('m1', 'Hello')]);
        });

        expect(result.current.chats[0].title).toBe('My title');
    });
});

describe('deleteChat', () => {
    it('deletes the chat in the backend and removes it from the list', async () => {
        const { result } = await renderChats([chat('b', NOW - 1000), chat('a', NOW - 5000)]);

        await act(async () => {
            result.current.deleteChat('a');
        });

        expect(mockDeleteChatRemote).toHaveBeenCalledWith('a');
        expect(result.current.chats.map((c) => c.id)).toEqual(['b']);
    });

    it('selects the first remaining chat when the current chat is deleted', async () => {
        const { result } = await renderChats([chat('c', NOW - 1000), chat('b', NOW - 2000), chat('a', NOW - 3000)]);

        await act(async () => {
            result.current.deleteChat('c');
        });

        expect(result.current.currentChatId).toBe('b');
    });

    it('keeps the selection when another chat is deleted', async () => {
        const { result } = await renderChats([chat('b', NOW - 1000), chat('a', NOW - 5000)]);

        await act(async () => {
            result.current.deleteChat('a');
        });

        expect(result.current.currentChatId).toBe('b');
    });

    it('leaves one fresh empty chat when the last chat is deleted', async () => {
        const { result } = await renderChats([chat('a', NOW - 1000)]);
        mockPushChat.mockClear();

        await act(async () => {
            result.current.deleteChat('a');
        });

        expect(result.current.chats).toHaveLength(1);
        expect(result.current.chats[0]).toMatchObject({ title: 'Neuer Chat', messages: [] });
        expect(result.current.chats[0].id).not.toBe('a');
        expect(mockPushChat).toHaveBeenCalledWith(result.current.chats[0]);
    });
});

describe('selectChat', () => {
    it('changes the current chat', async () => {
        const { result } = await renderChats([chat('b', NOW - 1000), chat('a', NOW - 5000)]);

        await act(async () => {
            result.current.selectChat('a');
        });

        expect(result.current.currentChatId).toBe('a');
        expect(result.current.currentChat?.id).toBe('a');
    });
});

// ---- Known problems (see PR "Findings") ----

describe('known problems in useChats', () => {
    // createChat uses the `chats` of the last render, not a functional update.
    // A change made in the same tick (e.g. updateChat) is lost.
    it.todo('createChat keeps a change made in the same tick');

    // deleteChat calls setCurrentChatId and pushChat inside the setChats updater.
    // In React Strict Mode the updater runs twice, so two fresh chats can be pushed.
    it.todo('deleteChat of the last chat pushes only one fresh chat in Strict Mode');
});
