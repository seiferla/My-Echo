// Serial queue for the sentence prefetch. No expo imports, so it can be tested
// alone; the app instance is in tts.ts.
//
// - One request at a time (limits the load).
// - Same sentence → same job (no double requests).
// - stillWanted: a typing job whose sentence is no longer in the text is skipped.
//   But if speak() waits for the job (awaitPending, or enqueue without
//   stillWanted), it runs anyway ("forced"). Else a reset on send would drop
//   exactly the sentences that are about to be spoken.

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

    /** Returns the running/queued job for the sentence (and forces it), or null. */
    function awaitPending(text: string, voice: string, model: string): Promise<void> | null {
        const key = keyOf(text, voice, model);
        const job = inflight.get(key);
        if (!job) return null;
        forced.add(key);
        return job;
    }

    return { enqueue, awaitPending };
}
