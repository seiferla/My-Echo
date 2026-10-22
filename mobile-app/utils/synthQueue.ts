// Serielle Warteschlange für die Satz-Vorab-Synthese (ohne expo-Abhängigkeit,
// damit isoliert testbar; die App-Instanz steht in tts.ts).
//
// - Ein Request gleichzeitig (begrenzt die Last).
// - Gleicher Satz → derselbe Job (keine doppelten Requests).
// - stillWanted: Typing-Jobs, deren Satz beim Start nicht mehr im Text steht,
//   werden übersprungen. Wartet aber speak() auf den Job (awaitPending/enqueue
//   ohne stillWanted), wird er trotzdem ausgeführt („forced“) — sonst würde ein
//   Reset beim Senden genau die Sätze verwerfen, die gleich gesprochen werden.

export type SynthFn = (text: string, voice: string, model: string) => Promise<void>;

export function createSynthQueue(synth: SynthFn, onError: (e: unknown) => void = () => {}) {
    const inflight = new Map<string, Promise<void>>();
    const forced = new Set<string>();
    let tail: Promise<void> = Promise.resolve();

    const keyOf = (text: string, voice: string, model: string) => `${voice}|${model}|${text}`;

    function enqueue(
        text: string,
        voice: string,
        model: string,
        stillWanted?: () => boolean,
    ): Promise<void> {
        const key = keyOf(text, voice, model);
        const existing = inflight.get(key);
        if (existing) {
            if (!stillWanted) forced.add(key);
            return existing;
        }
        if (!stillWanted) forced.add(key);

        const job = tail
            .then(async () => {
                if (stillWanted && !stillWanted() && !forced.has(key)) return;
                await synth(text, voice, model);
            })
            .catch(onError)
            .finally(() => {
                inflight.delete(key);
                forced.delete(key);
            });

        inflight.set(key, job);
        tail = job;
        return job;
    }

    /** Läuft/wartet ein Job für den Satz? Dann darauf warten (und ihn erzwingen). */
    function awaitPending(text: string, voice: string, model: string): Promise<void> | null {
        const key = keyOf(text, voice, model);
        const job = inflight.get(key);
        if (!job) return null;
        forced.add(key);
        return job;
    }

    /** Resolved, sobald die Warteschlange leer ist. */
    function idle(): Promise<void> {
        return tail;
    }

    return { enqueue, awaitPending, idle };
}
