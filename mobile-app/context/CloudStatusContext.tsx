import React, { createContext, useContext, useState, useEffect } from 'react';
import { BACKEND_HEALTH_URL } from '../utils/config';

const TAG = '[myEcho][Health]';
const CHECK_INTERVAL_MS = 30_000; // alle 30 Sekunden

interface CloudStatusContextType {
    isAvailable: boolean;
}

const CloudStatusContext = createContext<CloudStatusContextType>({ isAvailable: false });

/**
 * Pollt den /health-Endpunkt des Backends und stellt den Status
 * per Context bereit. In _layout.tsx einbinden.
 */
export function CloudStatusProvider({ children }: { children: React.ReactNode }) {
    const [isAvailable, setIsAvailable] = useState(false);

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
                setIsAvailable(ok);
                console.log(`${TAG} Cloud available: ${ok}`);
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
        <CloudStatusContext.Provider value={{ isAvailable }}>
            {children}
        </CloudStatusContext.Provider>
    );
}

export function useCloudStatus() {
    return useContext(CloudStatusContext);
}
