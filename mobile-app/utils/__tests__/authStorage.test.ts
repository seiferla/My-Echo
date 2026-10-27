import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import * as SecureStore from 'expo-secure-store';
import { authStorage } from '../authStorage';

// SecureStore as an in-memory map. `__keys` lists what is stored.
jest.mock('expo-secure-store', () => {
    const store = new Map<string, string>();
    return {
        getItemAsync: async (key: string) => store.get(key) ?? null,
        setItemAsync: async (key: string, value: string) => {
            store.set(key, value);
        },
        deleteItemAsync: async (key: string) => {
            store.delete(key);
        },
        __keys: () => [...store.keys()].sort(),
    };
});

const KEY = 'session';
const storedKeys = () => (SecureStore as unknown as { __keys: () => string[] }).__keys();

// Long text with a different char per position, so a wrong chunk order shows up.
const longValue = (length: number) =>
    Array.from({ length }, (_, i) => String.fromCharCode(65 + (i % 26))).join('');

beforeEach(async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    await authStorage.removeItem(KEY);
});

describe('authStorage', () => {
    it('splits a long value into chunks and reads it back unchanged', async () => {
        const value = longValue(4000);
        await authStorage.setItem(KEY, value);

        expect(storedKeys()).toEqual(['session.0', 'session.1', 'session.2', 'session.count']);
        expect(await SecureStore.getItemAsync('session.count')).toBe('3');
        expect((await SecureStore.getItemAsync('session.0'))?.length).toBe(1500);
        expect(await authStorage.getItem(KEY)).toBe(value);
    });

    it('deletes old chunks when the value gets shorter', async () => {
        await authStorage.setItem(KEY, longValue(4000));
        const shortValue = longValue(1000);
        await authStorage.setItem(KEY, shortValue);

        expect(storedKeys()).toEqual(['session.0', 'session.count']);
        expect(await authStorage.getItem(KEY)).toBe(shortValue);
    });

    it('returns null when a chunk is missing', async () => {
        await authStorage.setItem(KEY, longValue(4000));
        await SecureStore.deleteItemAsync('session.1');

        expect(await authStorage.getItem(KEY)).toBeNull();
    });

    it('returns null when nothing is stored', async () => {
        expect(await authStorage.getItem(KEY)).toBeNull();
    });
});
