import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useCloudStatus } from './CloudStatusContext';
import {
    Phrase,
    PhraseSettings,
    DEFAULT_SETTINGS,
    MAX_VISIBLE_PHRASES,
    loadPhraseStore,
    savePhraseStore,
    syncPhraseStore,
    newPhraseId,
    prewarmPhrases,
    reorder,
} from '../utils/phrases';

interface PhrasesContextType {
    phrases: Phrase[];
    settings: PhraseSettings;
    ready: boolean;
    // The phrases the ChatArea shows (max. 3).
    visiblePhrases: Phrase[];
    addPhrase: (text: string) => void;
    updatePhrase: (id: string, text: string) => void;
    deletePhrase: (id: string) => void;
    movePhrase: (id: string, direction: -1 | 1) => void;
    reorderPhrases: (from: number, to: number) => void;
    setVisibleCount: (count: number) => void;
    setInstantEnabled: (enabled: boolean) => void;
    recordUse: (id: string) => void;
}

const PhrasesContext = createContext<PhrasesContextType>({
    phrases: [],
    settings: DEFAULT_SETTINGS,
    ready: false,
    visiblePhrases: [],
    addPhrase: () => {},
    updatePhrase: () => {},
    deletePhrase: () => {},
    movePhrase: () => {},
    reorderPhrases: () => {},
    setVisibleCount: () => {},
    setInstantEnabled: () => {},
    recordUse: () => {},
});

/**
 * Holds the quick phrases and their settings, so the chat screen and the
 * phrases screen show the same data (changes appear in the ChatArea at once).
 * Every change is written to the JSON file directly; the list is small, so
 * no debounce is needed.
 */
export function PhrasesProvider({ children }: { children: React.ReactNode }) {
    const { isAvailable, voice, model } = useCloudStatus();
    const [phrases, setPhrases] = useState<Phrase[]>([]);
    const [settings, setSettings] = useState<PhraseSettings>(DEFAULT_SETTINGS);
    const [ready, setReady] = useState(false);
    // Text/voice pairs that are already prewarmed, so not every render loops over all phrases.
    const prewarmedRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        let alive = true;
        loadPhraseStore().then((store) => {
            if (!alive) return;
            setPhrases(store.phrases);
            setSettings(store.settings);
            setReady(true);

            // Show local phrases at once (also offline), then sync in the background.
            syncPhraseStore(store).then((synced) => {
                if (!alive || !synced) return;
                setPhrases(synced.phrases);
                setSettings(synced.settings);
            });
        });
        return () => {
            alive = false;
        };
    }, []);

    const visiblePhrases = phrases.slice(0, settings.visibleCount);

    // Load the audio of the visible phrases into the cache when the backend is
    // reachable. After that a tap on a phrase needs no network.
    useEffect(() => {
        if (!ready || !isAvailable || visiblePhrases.length === 0) return;
        const key = (p: Phrase) => `${p.text}|${voice}|${model}`;
        const pending = visiblePhrases.filter(
            (p) => p.text.trim() && !prewarmedRef.current.has(key(p))
        );
        if (pending.length === 0) return;
        pending.forEach((p) => prewarmedRef.current.add(key(p)));
        prewarmPhrases(pending, isAvailable, voice, model).catch(() => {
            // Not critical: a tap loads the audio live. Free the keys for a retry.
            pending.forEach((p) => prewarmedRef.current.delete(key(p)));
        });
    }, [ready, isAvailable, voice, model, phrases, settings.visibleCount]);

    const commit = (nextPhrases: Phrase[], nextSettings: PhraseSettings = settings) => {
        setPhrases(nextPhrases);
        setSettings(nextSettings);
        savePhraseStore({ phrases: nextPhrases, settings: nextSettings });
    };

    const addPhrase = (text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        commit([
            ...phrases,
            {
                id: newPhraseId(),
                text: trimmed,
                useCount: 0,
                createdAt: Date.now(),
            },
        ]);
    };

    const updatePhrase = (id: string, text: string) => {
        const trimmed = text.trim();
        if (!trimmed) return;
        commit(phrases.map((p) => (p.id === id ? { ...p, text: trimmed } : p)));
    };

    const deletePhrase = (id: string) => {
        commit(phrases.filter((p) => p.id !== id));
    };

    // The order is manual on purpose (drag & drop or arrows). Sorting by use
    // would move the phrases all the time and break muscle memory; for fast
    // answers a stable order matters more.
    const reorderPhrases = (from: number, to: number) => {
        const next = reorder(phrases, from, to);
        if (next !== phrases) commit(next);
    };

    const movePhrase = (id: string, direction: -1 | 1) => {
        const index = phrases.findIndex((p) => p.id === id);
        if (index < 0) return;
        reorderPhrases(index, index + direction);
    };

    const setVisibleCount = (count: number) => {
        const clamped = Math.max(0, Math.min(MAX_VISIBLE_PHRASES, Math.trunc(count)));
        commit(phrases, { ...settings, visibleCount: clamped });
    };

    const setInstantEnabled = (enabled: boolean) => {
        commit(phrases, { ...settings, instantEnabled: enabled });
    };

    const recordUse = (id: string) => {
        commit(
            phrases.map((p) =>
                p.id === id
                    ? { ...p, useCount: (p.useCount ?? 0) + 1, lastUsedAt: Date.now() }
                    : p
            )
        );
    };

    return (
        <PhrasesContext.Provider
            value={{
                phrases,
                settings,
                ready,
                visiblePhrases,
                addPhrase,
                updatePhrase,
                deletePhrase,
                movePhrase,
                reorderPhrases,
                setVisibleCount,
                setInstantEnabled,
                recordUse,
            }}
        >
            {children}
        </PhrasesContext.Provider>
    );
}

export function usePhrases() {
    return useContext(PhrasesContext);
}
