import React, { createContext, useContext, useState, useEffect } from 'react';
import { BACKEND_HEALTH_URL } from '../utils/config';

const TAG = '[myEcho][Health]';
const CHECK_INTERVAL_MS = 30_000;

interface CloudStatusContextType {
    isAvailable: boolean;
    voice: string;
    model: string;
}

const CloudStatusContext = createContext<CloudStatusContextType>({
    isAvailable: false,
    voice: '',
    model: '',
});

/**
 * Polls the backend's /health route and provides the status plus voice and
 * model. voice/model are part of the cache key, so after a voice change in
 * the backend no old audio is played. Used in _layout.tsx.
 */
export function CloudStatusProvider({ children }: { children: React.ReactNode }) {
    const [isAvailable, setIsAvailable] = useState(false);
    const [voice, setVoice] = useState('');
    const [model, setModel] = useState('');

    useEffect(() => {
        const check = async () => {
            console.log(`${TAG} Checking → ${BACKEND_HEALTH_URL}`);
            try {
                const t0 = Date.now();
                const response = await fetch(BACKEND_HEALTH_URL, {
                    signal: AbortSignal.timeout(5000),
                });
                const data = await response.json();
                const ok = data.status === 'ok';
                const latency = Date.now() - t0;

                console.log(`${TAG} Response (${latency} ms): status=${data.status} HTTP=${response.status}`);
                if (data.message) {
                    console.warn(`${TAG} Message: ${data.message}`);
                }
                // Update voice + model on every answer (also when status != ok),
                // so the cache key stays right after a short backend outage.
                if (typeof data.voice === 'string') setVoice(data.voice);
                if (typeof data.model === 'string') setModel(data.model);

                setIsAvailable(ok);
                console.log(`${TAG} Cloud available: ${ok} (voice=${data.voice ?? '?'}, model=${data.model ?? '?'})`);
            } catch (error: any) {
                console.warn(`${TAG} Health check failed: ${error?.message ?? error}`);
                setIsAvailable(false);
            }
        };

        check(); // once at start
        const interval = setInterval(check, CHECK_INTERVAL_MS);
        return () => clearInterval(interval);
    }, []);

    return (
        <CloudStatusContext.Provider value={{ isAvailable, voice, model }}>
            {children}
        </CloudStatusContext.Provider>
    );
}

export function useCloudStatus() {
    return useContext(CloudStatusContext);
}
