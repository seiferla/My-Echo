import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

const TAG = '[myEcho][Storage]';

export const storage = {
    async setItem(key: string, value: string): Promise<void> {
        try {
            if (Platform.OS === 'web') {
                localStorage.setItem(key, value);
            } else {
                await SecureStore.setItemAsync(key, value);
            }
        } catch (e) {
            console.error(`${TAG} setItem failed for key "${key}":`, e);
            throw e;
        }
    },

    async getItem(key: string): Promise<string | null> {
        try {
            if (Platform.OS === 'web') {
                return localStorage.getItem(key);
            } else {
                return await SecureStore.getItemAsync(key);
            }
        } catch (e) {
            console.error(`${TAG} getItem failed for key "${key}":`, e);
            return null;
        }
    },
};
