import { splitCompletedSentences } from './split';

// Kernlogik der Satz-Vorab-Synthese beim Tippen (ohne Abhängigkeit zu expo-Modulen,
// damit sie isoliert testbar ist; die App-Instanz steht in typingPrefetch.ts).
//
// Regeln:
// - Ein Satz, der durch eine Änderung AM ENDE des Textes abgeschlossen wird
//   (. ! ?), wird sofort synthetisiert. „Am Ende“ zählt auch, wenn die Tastatur
//   dabei das letzte Wort ersetzt (Autokorrektur, Doppel-Leerzeichen → Punkt).
// - Jede andere Änderung (Korrektur mitten im Text, Löschen, Einfügen) wartet
//   idleMs Tipppause ab und synthetisiert dann nur die Endfassung. Sonst würde
//   jeder Tastendruck in einem fertigen Satz einen neuen Request auslösen.
// - Der unfertige Rest wird ebenfalls erst nach der Tipppause synthetisiert.
// - Sätze, die nicht mehr im Text stehen, werden aus der Warteschlange verworfen
//   (stillWanted) und dürfen später erneut angefragt werden.

export type PrefetchFn = (
    sentence: string,
    voice: string,
    model: string,
    stillWanted: () => boolean,
) => Promise<void>;

export const TYPING_IDLE_MS = 1000;

// true, wenn sich prev → next nur am Textende geändert hat (Anhängen, Löschen oder
// Ersetzen am Ende). Vergleich ohne abschließendes Whitespace. Eine Änderung in der
// Mitte lässt einen gemeinsamen Rest am Ende stehen → false.
export function isEditAtEnd(prev: string, next: string): boolean {
    const a = prev.trimEnd();
    const b = next.trimEnd();
    let prefix = 0;
    const max = Math.min(a.length, b.length);
    while (prefix < max && a[prefix] === b[prefix]) prefix++;
    // Gemeinsames Ende nur hinter dem gemeinsamen Anfang suchen.
    return a.length === prefix || b.length === prefix || a[a.length - 1] !== b[b.length - 1];
}

export function createTypingPrefetcher(
    prefetch: PrefetchFn,
    enabled: () => boolean = () => true,
    idleMs: number = TYPING_IDLE_MS,
) {
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let prevText = '';
    // Schon angefragte Sätze (spart den Cache-Lookup bei jedem Tastendruck).
    const requested = new Set<string>();
    // Sätze, die im aktuellen Text stehen.
    let wanted = new Set<string>();

    const keyOf = (s: string, voice: string, model: string) => `${voice}|${model}|${s}`;

    function request(s: string, voice: string, model: string): void {
        const key = keyOf(s, voice, model);
        if (requested.has(key)) return;
        requested.add(key);
        prefetch(s, voice, model, () => wanted.has(s)).then(() => {
            // Nicht mehr im Text (verworfen oder überholt) → später neu anfragbar.
            if (!wanted.has(s)) requested.delete(key);
        });
    }

    function clearTimer(): void {
        if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
        }
    }

    function onTypingChanged(text: string, voice: string, model: string): void {
        if (!enabled()) return;
        clearTimer();

        const { completed, remainder } = splitCompletedSentences(text);
        const all = remainder ? [...completed, remainder] : completed;
        wanted = new Set(all);

        const atEnd = isEditAtEnd(prevText, text);
        prevText = text;

        const immediate = atEnd ? completed : [];
        for (const s of immediate) request(s, voice, model);

        const deferred = all.filter(
            (s) => !immediate.includes(s) && !requested.has(keyOf(s, voice, model)),
        );
        if (deferred.length > 0) {
            idleTimer = setTimeout(() => {
                idleTimer = null;
                for (const s of deferred) request(s, voice, model);
            }, idleMs);
        }
    }

    /** Eingabe beendet (gesendet, geschlossen, neuer Test): Timer und Merkliste leeren. */
    function reset(): void {
        clearTimer();
        requested.clear();
        wanted = new Set();
        prevText = '';
    }

    return { onTypingChanged, reset };
}
