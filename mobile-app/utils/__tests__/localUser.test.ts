import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createFakeFileSystem } from '../../test/fakeFileSystem';
import { createFakeStorage } from '../../test/fakeStorage';

type LocalUser = typeof import('../localUser');

// ---- Fakes ------------------------------------------------------------------------

const mockFs = createFakeFileSystem();
const mockStorage = createFakeStorage();

jest.mock('expo-file-system', () => mockFs.module);
jest.mock('../storage', () => mockStorage.module);

// ---- Helpers ----------------------------------------------------------------------

/** Fresh module state (no signed-in user). */
function load(): LocalUser {
    jest.resetModules();
    return require('../localUser') as LocalUser;
}

const file = (name: string) => `documents/${name}`;

/** Data of an install from before accounts existed (one device, one person). */
function givenLegacyInstall() {
    mockFs.dirs.add(file('tts-cache'));
    mockFs.files.set(file('tts-cache/abc.mp3'), 'audio');
    mockFs.files.set(file('chats.json'), '[old chats]');
    mockFs.files.set(file('phrases.json'), '{old phrases}');
    mockStorage.items.set('myEchoChatsFile', 'web chats');
    mockStorage.items.set('myEchoPhrases', 'web phrases');
    mockStorage.items.set('myEchoTtsStats', 'stats');
}

beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    mockFs.clear();
    mockStorage.clear();
});

afterEach(() => {
    jest.dontMock('react-native');
    jest.restoreAllMocks();
});

// ---- Tests ------------------------------------------------------------------------

describe('scoped', () => {
    it('uses "signed-out" without a user', () => {
        const { scoped } = load();

        expect(scoped('chats')).toBe('chats.signed-out');
    });

    it('adds the id of the signed-in user, and drops it on sign-out', () => {
        const { scoped, setLocalUser } = load();

        setLocalUser('u1');
        expect(scoped('chats')).toBe('chats.u1');

        setLocalUser(null);
        expect(scoped('chats')).toBe('chats.signed-out');
    });
});

describe('adoptLegacyData', () => {
    it('moves the old files to the first account', async () => {
        givenLegacyInstall();

        await load().adoptLegacyData('u1');

        expect(mockFs.files.get(file('chats.u1.json'))).toBe('[old chats]');
        expect(mockFs.files.get(file('phrases.u1.json'))).toBe('{old phrases}');
        expect(mockFs.files.has(file('chats.json'))).toBe(false);
        expect(mockFs.files.has(file('phrases.json'))).toBe(false);
    });

    it('moves the old storage keys to the first account', async () => {
        givenLegacyInstall();

        await load().adoptLegacyData('u1');

        expect(Object.fromEntries(mockStorage.items)).toEqual({
            'myEchoChatsFile.u1': 'web chats',
            'myEchoPhrases.u1': 'web phrases',
            'myEchoTtsStats.u1': 'stats',
        });
    });

    it('deletes the old shared audio cache, because it belongs to no account', async () => {
        givenLegacyInstall();

        await load().adoptLegacyData('u1');

        expect(mockFs.dirs.has(file('tts-cache'))).toBe(false);
        expect(mockFs.files.has(file('tts-cache/abc.mp3'))).toBe(false);
    });

    it('gives a second account nothing of the first one', async () => {
        givenLegacyInstall();
        const localUser = load();

        await localUser.adoptLegacyData('u1');
        await localUser.adoptLegacyData('u2');

        expect(mockFs.files.has(file('chats.u2.json'))).toBe(false);
        expect([...mockStorage.items.keys()].some((key) => key.endsWith('.u2'))).toBe(false);
    });

    it('never overwrites data the account already has', async () => {
        givenLegacyInstall();
        mockFs.files.set(file('chats.u1.json'), '[new chats]');
        mockStorage.items.set('myEchoPhrases.u1', 'new phrases');

        await load().adoptLegacyData('u1');

        expect(mockFs.files.get(file('chats.u1.json'))).toBe('[new chats]');
        expect(mockStorage.items.get('myEchoPhrases.u1')).toBe('new phrases');
    });

    it('does nothing on a fresh install', async () => {
        await load().adoptLegacyData('u1');

        expect(mockFs.files.size).toBe(0);
        expect(mockStorage.items.size).toBe(0);
    });

    it('on web, moves only the storage keys (there are no files)', async () => {
        givenLegacyInstall();
        jest.resetModules();
        jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
        const { adoptLegacyData } = require('../localUser') as LocalUser;

        await adoptLegacyData('u1');

        expect(mockFs.files.has(file('chats.json'))).toBe(true);
        expect(mockStorage.items.get('myEchoChatsFile.u1')).toBe('web chats');
    });
});
