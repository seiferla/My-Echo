// In-memory replacement for utils/storage.ts (SecureStore / localStorage).
//
//   const mockStorage = createFakeStorage();
//   jest.mock('../storage', () => mockStorage.module);

export function createFakeStorage() {
    const items = new Map<string, string>();

    return {
        /** key → value */
        items,
        /** Pass this to jest.mock('.../storage', ...). */
        module: {
            storage: {
                // Same promise-based API as the real storage helper.
                getItem: (key: string) => Promise.resolve(items.get(key) ?? null),
                setItem: (key: string, value: string) => {
                    items.set(key, value);
                    return Promise.resolve();
                },
                removeItem: (key: string) => {
                    items.delete(key);
                    return Promise.resolve();
                },
            },
        },
        clear() {
            items.clear();
        },
    };
}
