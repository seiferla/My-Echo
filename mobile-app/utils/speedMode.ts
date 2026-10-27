import { useEffect, useState } from 'react';
import { storage } from './storage';

// Fast / eco mode for typing:
// - Fast: sentences are synthesized while typing (instant answer on send,
//   but also requests for text that changes later).
// - Eco: synthesis starts on send (fewer requests, longer wait).
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
