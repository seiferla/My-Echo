import { useEffect, useState } from 'react';
import { storage } from './storage';

// Schnell-/Eco-Modus fürs Tippen:
// - Schnell: Sätze werden schon während des Tippens synthetisiert (Antwort sofort
//   beim Senden, dafür auch Requests für Text, der später geändert wird).
// - Eco: Es wird erst beim Senden synthetisiert (weniger Requests, längere Wartezeit).
const KEY = 'myEchoFastMode';

export function useFastMode(): [boolean, (fast: boolean) => void] {
    const [fast, setFast] = useState(true);

    useEffect(() => {
        storage.getItem(KEY).then((v) => {
            if (v === '0') setFast(false);
        });
    }, []);

    const update = (next: boolean) => {
        setFast(next);
        storage.setItem(KEY, next ? '1' : '0').catch(() => {});
    };

    return [fast, update];
}
