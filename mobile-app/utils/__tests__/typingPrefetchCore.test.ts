import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { createTypingPrefetcher, isEditAtEnd, PrefetchFn, TYPING_IDLE_MS } from '../typingPrefetchCore';

// ---- Helpers --------------------------------------------------------------------

/** A prefetcher with a recording prefetch function. Every request stays open until released. */
function setup(options: { enabled?: () => boolean } = {}) {
    const releases: (() => void)[] = [];
    const prefetch = jest.fn<PrefetchFn>(
        () => new Promise<void>((resolve) => releases.push(resolve)),
    );
    const prefetcher = createTypingPrefetcher(prefetch, options.enabled);

    return {
        prefetch,
        prefetcher,
        type: (text: string, voice = 'v', model = 'm') => prefetcher.onTypingChanged(text, voice, model),
        /** Sentences requested so far, in order. */
        requested: () => prefetch.mock.calls.map(([sentence]) => sentence),
        /** stillWanted() of the n-th request. */
        stillWanted: (n: number) => prefetch.mock.calls[n][3](),
        /** Finishes all open requests and lets their .then() run. */
        releaseAll: async () => {
            releases.splice(0).forEach((release) => release());
            await jest.advanceTimersByTimeAsync(0);
        },
    };
}

beforeEach(() => {
    jest.useFakeTimers();
});

afterEach(() => {
    jest.useRealTimers();
});

// ---- isEditAtEnd ------------------------------------------------------------------

describe('isEditAtEnd', () => {
    it.each([
        ['first input', '', 'Hallo', true],
        ['append', 'Hallo', 'Hallo.', true],
        ['delete at the end', 'Hallo.', 'Hallo', true],
        ['autocorrect on the period replaces the last word', 'Ich bin mude', 'Ich bin müde.', true],
        // Known limit: a fix that keeps the last character counts as a middle edit
        // (it only waits for the typing pause, nothing is lost).
        ['fix inside the last word, same last character', 'Ich bin mude', 'Ich bin müde', false],
        ['double space becomes a period', 'Hallo  ', 'Hallo. ', true],
        ['only trailing whitespace changes', 'Hallo', 'Hallo   ', true],
        ['fix in the middle', 'Ich bin mude.', 'Ich bin müde.', false],
        ['insert in the middle', 'Hallo Welt.', 'Hallo schöne Welt.', false],
    ])('%s → %s', (_case, prev, next, expected) => {
        expect(isEditAtEnd(prev, next)).toBe(expected);
    });
});

// ---- createTypingPrefetcher -----------------------------------------------------------

describe('createTypingPrefetcher', () => {
    describe('typing at the end', () => {
        it('requests a finished sentence at once', () => {
            const t = setup();

            t.type('Hallo.');

            expect(t.requested()).toEqual(['Hallo.']);
        });

        it('requests the unfinished rest only after the typing pause', () => {
            const t = setup();

            t.type('Hallo. Wie geh');
            expect(t.requested()).toEqual(['Hallo.']);

            jest.advanceTimersByTime(TYPING_IDLE_MS - 1);
            expect(t.requested()).toEqual(['Hallo.']);

            jest.advanceTimersByTime(1);
            expect(t.requested()).toEqual(['Hallo.', 'Wie geh']);
        });

        it('starts the pause again on every key press', () => {
            const t = setup();

            t.type('Wie');
            jest.advanceTimersByTime(TYPING_IDLE_MS - 100);
            t.type('Wie geht');
            jest.advanceTimersByTime(TYPING_IDLE_MS - 100);

            expect(t.requested()).toEqual([]);

            jest.advanceTimersByTime(100);
            expect(t.requested()).toEqual(['Wie geht']);
        });

        it('requests each sentence only once', () => {
            const t = setup();

            t.type('Hallo.');
            t.type('Hallo. W');
            t.type('Hallo. Wie');
            jest.advanceTimersByTime(TYPING_IDLE_MS);

            expect(t.requested()).toEqual(['Hallo.', 'Wie']);
        });
    });

    describe('editing in the middle', () => {
        it('waits for the pause and then requests only the final text', () => {
            const t = setup();
            t.type('Ich bin mude.');

            t.type('Ich bin müde.');
            expect(t.requested()).toEqual(['Ich bin mude.']);

            jest.advanceTimersByTime(TYPING_IDLE_MS);
            expect(t.requested()).toEqual(['Ich bin mude.', 'Ich bin müde.']);
        });
    });

    describe('sentences that leave the text', () => {
        it('reports them as no longer wanted', () => {
            const t = setup();
            t.type('Hallo.');
            expect(t.stillWanted(0)).toBe(true);

            t.type('Hallo!');

            expect(t.stillWanted(0)).toBe(false);
            expect(t.stillWanted(1)).toBe(true);
        });

        it('may be requested again when they come back later', async () => {
            const t = setup();
            t.type('Hallo.');
            t.type('Hallo!');
            await t.releaseAll(); // 'Hallo.' finishes while it is not in the text

            t.type('Hallo.');

            expect(t.requested()).toEqual(['Hallo.', 'Hallo!', 'Hallo.']);
        });

        it('are not requested again while they stay in the text', async () => {
            const t = setup();
            t.type('Hallo.');
            await t.releaseAll();

            t.type('Hallo. ');
            t.type('Hallo.');

            expect(t.requested()).toEqual(['Hallo.']);
        });
    });

    describe('voice and model', () => {
        it('treat another voice or model as a new request', () => {
            const t = setup();

            t.type('Hallo.', 'voice-a', 'model-1');
            t.prefetcher.reset();
            t.type('Hallo.', 'voice-b', 'model-1');
            t.prefetcher.reset();
            t.type('Hallo.', 'voice-b', 'model-2');

            expect(t.prefetch.mock.calls.map(([s, voice, model]) => `${s}|${voice}|${model}`)).toEqual([
                'Hallo.|voice-a|model-1',
                'Hallo.|voice-b|model-1',
                'Hallo.|voice-b|model-2',
            ]);
        });
    });

    describe('reset', () => {
        it('cancels the pending pause', () => {
            const t = setup();
            t.type('Wie geh');

            t.prefetcher.reset();
            jest.advanceTimersByTime(TYPING_IDLE_MS);

            expect(t.requested()).toEqual([]);
        });

        it('lets the same sentence be requested again', () => {
            const t = setup();
            t.type('Hallo.');

            t.prefetcher.reset();
            t.type('Hallo.');

            expect(t.requested()).toEqual(['Hallo.', 'Hallo.']);
        });
    });

    describe('when disabled', () => {
        it('requests nothing', () => {
            const t = setup({ enabled: () => false });

            t.type('Hallo. Wie geht');
            jest.advanceTimersByTime(TYPING_IDLE_MS);

            expect(t.requested()).toEqual([]);
        });
    });
});
