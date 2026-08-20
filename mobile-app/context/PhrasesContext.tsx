import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { useCloudStatus } from './CloudStatusContext';
import {
    Phrase,
    PhraseSettings,
    DEFAULT_SETTINGS,
    MAX_VISIBLE_PHRASES,
    loadPhraseStore,
    savePhraseStore,
    newPhraseId,
    prewarmPhrases,
    reorder,
} from '../utils/phrases';

interface PhrasesContextType {
    phrases: Phrase[];
    settings: PhraseSettings;
    ready: boolean;
    // Die Phrasen, die tatsächlich in der ChatArea liegen (max. 3).
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
 * Hält Schnell-Phrasen und ihre Anzeige-Einstellungen im Speicher, damit
 * Chat-Screen und Verwaltungs-Seite denselben Stand sehen (Änderungen
 * erscheinen sofort in der ChatArea). Schreibt jede Änderung direkt in die
 * JSON-Datei — die Liste ist klein, eine Debounce-Logik wäre unnötig.
 */
export function PhrasesProvider({ children }: { children: React.ReactNode }) {
    const { isAvailable, voice, model } = useCloudStatus();
    const [phrases, setPhrases] = useState<Phrase[]>([]);
    const [settings, setSettings] = useState<PhraseSettings>(DEFAULT_SETTINGS);
    const [ready, setReady] = useState(false);
    // Merkt sich, welche Text/Stimme-Kombination schon vorgewärmt wurde —
    // verhindert, dass jeder Render-Durchlauf erneut über alle Phrasen läuft.
    const prewarmedRef = useRef<Set<string>>(new Set());

    useEffect(() => {
        loadPhraseStore().then((store) => {
            setPhrases(store.phrases);
            setSettings(store.settings);
            setReady(true);
        });
    }, []);

    const visiblePhrases = phrases.slice(0, settings.visibleCount);

    // Audio der sichtbaren Phrasen vorab in den Cache holen, sobald das Backend
    // erreichbar ist. Danach kostet ein Phrasen-Tipp keine Netzwerkzeit mehr.
    useEffect(() => {
        if (!ready || !isAvailable || visiblePhrases.length === 0) return;
        const key = (p: Phrase) => `${p.text}|${voice}|${model}`;
        const pending = visiblePhrases.filter(
            (p) => p.text.trim() && !prewarmedRef.current.has(key(p))
        );
        if (pending.length === 0) return;
        pending.forEach((p) => prewarmedRef.current.add(key(p)));
        prewarmPhrases(pending, isAvailable, voice, model).catch(() => {
            // Fehlgeschlagenes Vorwärmen ist unkritisch — beim Antippen wird
            // notfalls live geladen. Keys wieder freigeben für einen Retry.
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

    // Reihenfolge bleibt bewusst manuell (Drag & Drop bzw. Pfeile): eine
    // automatische Sortierung nach Häufigkeit würde die Positionen ständig
    // verschieben und das Muskelgedächtnis zerstören — für schnelles Antworten
    // ist Vorhersagbarkeit wichtiger.
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
