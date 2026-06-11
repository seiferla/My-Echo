import React, { createContext, useContext, useState, useEffect } from 'react';
import { BACKEND_HEALTH_URL } from '../utils/config';

const TAG = '[myEcho][Health]';
const CHECK_INTERVAL_MS = 30_000; // alle 30 Sekunden

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
 * Pollt den /health-Endpunkt des Backends und stellt den Status
 * sowie voice + model per Context bereit. voice/model fließen in den
 * Cache-Key ein, damit ein Voice-Wechsel im Backend keine alten Audios mehr
 * abspielt. In _layout.tsx einbinden.
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
                if (data.credits !== undefined) {
                    console.log(`${TAG} Credits: ${JSON.stringify(data.credits)}`);
                }
                if (data.message) {
                    console.warn(`${TAG} Message: ${data.message}`);
                }
                // Voice + Model bei jeder Antwort aktualisieren (auch bei status != ok),
                // damit der Cache-Key konsistent bleibt sobald das Backend kurz weg war.
                if (typeof data.voice === 'string') setVoice(data.voice);
                if (typeof data.model === 'string') setModel(data.model);

                setIsAvailable(ok);
                console.log(`${TAG} Cloud available: ${ok} (voice=${data.voice ?? '?'}, model=${data.model ?? '?'})`);
            } catch (error: any) {
                console.warn(`${TAG} Health check failed: ${error?.message ?? error}`);
                setIsAvailable(false);
            }
        };

        check(); // sofort beim Start
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
