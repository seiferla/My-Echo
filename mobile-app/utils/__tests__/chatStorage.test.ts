import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createFakeFileSystem } from '../../test/fakeFileSystem';
import { createFakeStorage } from '../../test/fakeStorage';

type ChatStorage = typeof import('../chatStorage');
type LocalUser = typeof import('../localUser');

// ---- Fakes ------------------------------------------------------------------------

const mockFs = createFakeFileSystem();
const mockStorage = createFakeStorage();

jest.mock('expo-file-system', () => mockFs.module);
jest.mock('../storage', () => mockStorage.module);

// ---- Helpers ----------------------------------------------------------------------

/** Fresh modules, signed in as `user`. The real localUser decides the file name. */
function load(user: string | null = 'u1'): ChatStorage & Pick<LocalUser, 'setLocalUser'> {
    jest.resetModules();
    const { setLocalUser } = require('../localUser') as LocalUser;
    setLocalUser(user);
    return { ...(require('../chatStorage') as ChatStorage), setLocalUser };
}

const chatsFile = (user: string) => `documents/chats.${user}.json`;

beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockFs.clear();
    mockStorage.clear();
});

afterEach(() => {
    jest.dontMock('react-native');
    jest.restoreAllMocks();
});

// ---- Tests ------------------------------------------------------------------------

describe('readChats / writeChats', () => {
    it('returns null before anything was saved', async () => {
        expect(await load().readChats()).toBeNull();
    });

    it('reads back what was written, from one file per account', async () => {
        const { readChats, writeChats } = load('u1');

        await writeChats('[1,2]');

        expect(mockFs.files.get(chatsFile('u1'))).toBe('[1,2]');
        expect(await readChats()).toBe('[1,2]');
    });

    it('never returns the chats of another account', async () => {
        const { readChats, writeChats, setLocalUser } = load('u1');
        await writeChats('[chats of u1]');

        setLocalUser('u2');

        expect(await readChats()).toBeNull();
    });
});

describe('errors', () => {
    it('returns null when the file cannot be read', async () => {
        mockFs.files.set(chatsFile('u1'), '[1]');
        const { readChats } = load('u1');
        jest.spyOn(mockFs.module.File.prototype, 'textSync').mockImplementation(() => {
            throw new Error('disk error');
        });

        expect(await readChats()).toBeNull();
    });

    it('passes a write error on, so the caller knows nothing was saved', async () => {
        const { writeChats } = load('u1');
        jest.spyOn(mockFs.module.File.prototype, 'write').mockImplementation(() => {
            throw new Error('disk full');
        });

        await expect(writeChats('[1]')).rejects.toThrow('disk full');
    });
});

describe('web', () => {
    it('uses the storage helper with a key per account', async () => {
        jest.resetModules();
        jest.doMock('react-native', () => ({ Platform: { OS: 'web' } }));
        const { setLocalUser } = require('../localUser') as LocalUser;
        const { readChats, writeChats } = require('../chatStorage') as ChatStorage;
        setLocalUser('u1');

        await writeChats('[web]');

        expect(mockStorage.items.get('myEchoChatsFile.u1')).toBe('[web]');
        expect(await readChats()).toBe('[web]');
        expect(mockFs.files.size).toBe(0);
    });
});
