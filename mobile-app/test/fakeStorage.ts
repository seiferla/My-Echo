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
                getItem: async (key: string) => items.get(key) ?? null,
                setItem: async (key: string, value: string) => {
                    items.set(key, value);
                },
                removeItem: async (key: string) => {
                    items.delete(key);
                },
            },
        },
        clear() {
            items.clear();
        },
    };
}
