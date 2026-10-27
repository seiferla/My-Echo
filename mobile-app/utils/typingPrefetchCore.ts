import { splitCompletedSentences } from './split';

// Core logic of the sentence prefetch while typing. No expo imports, so it can
// be tested alone; the app instance is in typingPrefetch.ts.
//
// Rules:
// - A sentence finished (. ! ?) by an edit AT THE END of the text is synthesized
//   at once. "At the end" also counts when the keyboard replaces the last word
//   (autocorrect, double space → period).
// - Any other edit (fix in the middle, delete, paste) waits idleMs of no typing
//   and then synthesizes only the final text. Else every key press in a finished
//   sentence would send a new request.
// - The unfinished rest is also synthesized only after the typing pause.
// - Sentences no longer in the text are dropped from the queue (stillWanted)
//   and may be requested again later.

export type PrefetchFn = (
    sentence: string,
    voice: string,
    model: string,
    stillWanted: () => boolean,
) => Promise<void>;

export const TYPING_IDLE_MS = 1000;

// true when prev → next changed only at the end (append, delete or replace there).
// Trailing whitespace is ignored. An edit in the middle leaves a common end → false.
export function isEditAtEnd(prev: string, next: string): boolean {
    const a = prev.trimEnd();
    const b = next.trimEnd();
    let prefix = 0;
    const max = Math.min(a.length, b.length);
    while (prefix < max && a[prefix] === b[prefix]) prefix++;
    // Look for a common end only after the common start.
    return a.length === prefix || b.length === prefix || a[a.length - 1] !== b[b.length - 1];
}

export function createTypingPrefetcher(
    prefetch: PrefetchFn,
    enabled: () => boolean = () => true,
    idleMs: number = TYPING_IDLE_MS,
) {
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let prevText = '';
    // Sentences already requested (saves a cache lookup on every key press).
    const requested = new Set<string>();
    // Sentences in the current text.
    let wanted = new Set<string>();

    const keyOf = (s: string, voice: string, model: string) => `${voice}|${model}|${s}`;

    function request(s: string, voice: string, model: string): void {
        const key = keyOf(s, voice, model);
        if (requested.has(key)) return;
        requested.add(key);
        prefetch(s, voice, model, () => wanted.has(s)).then(() => {
            // No longer in the text (dropped or outdated): may be requested again later.
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

    /** Input finished (sent, closed, new test): clear the timer and the lists. */
    function reset(): void {
        clearTimer();
        requested.clear();
        wanted = new Set();
        prevText = '';
    }

    return { onTypingChanged, reset };
}
