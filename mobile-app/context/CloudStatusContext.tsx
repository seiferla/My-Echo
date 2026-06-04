import React, { createContext, useContext, useState, useEffect } from 'react';
import { BACKEND_HEALTH_URL } from '../utils/config';

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
            try {
                const response = await fetch(BACKEND_HEALTH_URL, {
                    signal: AbortSignal.timeout(5000),
                });
                const data = await response.json();
                setIsAvailable(data.status === 'ok');
            } catch {
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
