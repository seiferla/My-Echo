import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { act, renderHook } from '@testing-library/react-native';
import { PhrasesProvider, usePhrases } from '../PhrasesContext';
import type { Phrase, PhraseSettings, PhraseStore } from '../../utils/phrases';

// ---- Fakes ----

const mockLoadPhraseStore = jest.fn<() => Promise<PhraseStore>>();
const mockSyncPhraseStore = jest.fn<(local: PhraseStore) => Promise<PhraseStore | null>>();
const mockSavePhraseStore = jest.fn<(store: PhraseStore) => Promise<void>>();
const mockPrewarmPhrases =
    jest.fn<(p: Phrase[], available: boolean, voice: string, model: string) => Promise<number>>();
const mockNewPhraseId = jest.fn<() => string>();

// phrases.ts imports the audio code; it is not needed here.
jest.mock('../../utils/tts', () => ({ getShareableAudioUri: jest.fn() }));

// The pure helpers (reorder, defaults, limits) stay real.
jest.mock('../../utils/phrases', () => ({
    ...jest.requireActual<typeof import('../../utils/phrases')>('../../utils/phrases'),
    loadPhraseStore: () => mockLoadPhraseStore(),
    syncPhraseStore: (local: PhraseStore) => mockSyncPhraseStore(local),
    savePhraseStore: (store: PhraseStore) => mockSavePhraseStore(store),
    prewarmPhrases: (p: Phrase[], available: boolean, voice: string, model: string) =>
        mockPrewarmPhrases(p, available, voice, model),
    newPhraseId: () => mockNewPhraseId(),
}));

// The test can change this value and render again.
const cloud = { isAvailable: true, voice: 'v1', model: 'm1' };
jest.mock('../CloudStatusContext', () => ({
    useCloudStatus: () => cloud,
}));

// ---- Helpers ----

const NOW = 1_800_000_000_000;
const SETTINGS: PhraseSettings = { visibleCount: 3, instantEnabled: true };

function phrase(text: string, useCount = 0): Phrase {
    return { id: `id-${text}`, text, useCount, createdAt: 1 };
}

function store(phrases: Phrase[], settings: Partial<PhraseSettings> = {}): PhraseStore {
    return { phrases, settings: { ...SETTINGS, ...settings } };
}

/** A promise the test resolves by hand, to control when the backend answers. */
function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((res) => {
        resolve = res;
    });
    return { promise, resolve };
}

function wrapper({ children }: { children: React.ReactNode }) {
    return <PhrasesProvider>{children}</PhrasesProvider>;
}

/** Starts the provider with this local store and waits until it is ready. */
async function renderPhrases(local: PhraseStore) {
    mockLoadPhraseStore.mockResolvedValue(local);
    return renderHook(() => usePhrases(), { wrapper });
}

/** The store that was saved last. */
function lastSaved(): PhraseStore {
    const calls = mockSavePhraseStore.mock.calls;
    return calls[calls.length - 1][0];
}

function texts(list: Phrase[]): string[] {
    return list.map((p) => p.text);
}

/** The phrase texts of one prewarm call. */
function prewarmedTexts(callIndex: number): string[] {
    return texts(mockPrewarmPhrases.mock.calls[callIndex][0]);
}

// ---- Tests ----

describe('PhrasesContext', () => {
    beforeEach(() => {
        mockLoadPhraseStore.mockReset();
        mockSyncPhraseStore.mockReset().mockResolvedValue(null);
        mockSavePhraseStore.mockReset().mockResolvedValue(undefined);
        mockPrewarmPhrases.mockReset().mockResolvedValue(1);
        mockNewPhraseId.mockReset().mockReturnValue('new-id');
        cloud.isAvailable = true;
        cloud.voice = 'v1';
        cloud.model = 'm1';
        jest.spyOn(Date, 'now').mockReturnValue(NOW);
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    describe('without a provider', () => {
        it('returns an empty default value with harmless actions', async () => {
            const { result } = await renderHook(() => usePhrases());

            expect(result.current.phrases).toEqual([]);
            expect(result.current.visiblePhrases).toEqual([]);
            expect(result.current.ready).toBe(false);
            expect(result.current.settings).toEqual({ visibleCount: 3, instantEnabled: true });

            await act(async () => {
                result.current.addPhrase('x');
                result.current.updatePhrase('a', 'x');
                result.current.deletePhrase('a');
                result.current.movePhrase('a', 1);
                result.current.reorderPhrases(0, 1);
                result.current.setVisibleCount(1);
                result.current.setInstantEnabled(false);
                result.current.recordUse('a');
            });

            expect(mockSavePhraseStore).not.toHaveBeenCalled();
        });
    });

    describe('start', () => {
        it('loads the local store and becomes ready', async () => {
            const local = store([phrase('Ja'), phrase('Nein')], { instantEnabled: false });

            const { result } = await renderPhrases(local);

            expect(result.current.ready).toBe(true);
            expect(texts(result.current.phrases)).toEqual(['Ja', 'Nein']);
            expect(result.current.settings.instantEnabled).toBe(false);
            expect(mockSyncPhraseStore).toHaveBeenCalledWith(local);
        });

        it('shows local phrases first and applies the backend result later', async () => {
            const later = deferred<PhraseStore | null>();
            mockSyncPhraseStore.mockReturnValue(later.promise);

            const { result } = await renderPhrases(store([phrase('Local')]));

            expect(texts(result.current.phrases)).toEqual(['Local']);

            await act(async () => {
                later.resolve(store([phrase('Remote')], { visibleCount: 1 }));
            });

            expect(texts(result.current.phrases)).toEqual(['Remote']);
            expect(result.current.settings.visibleCount).toBe(1);
        });

        it('keeps the local phrases when the sync result is null', async () => {
            mockSyncPhraseStore.mockResolvedValue(null);

            const { result } = await renderPhrases(store([phrase('Local')]));

            expect(texts(result.current.phrases)).toEqual(['Local']);
            expect(result.current.settings).toEqual(SETTINGS);
        });

        it('ignores the sync result after unmount', async () => {
            const later = deferred<PhraseStore | null>();
            mockSyncPhraseStore.mockReturnValue(later.promise);
            const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
            const { result, unmount } = await renderPhrases(store([phrase('Local')]));

            await unmount();
            await act(async () => {
                later.resolve(store([phrase('Remote')]));
            });

            expect(texts(result.current.phrases)).toEqual(['Local']);
            expect(errorSpy).not.toHaveBeenCalled();
        });

        it('ignores the local store when unmounted before it loaded', async () => {
            const loading = deferred<PhraseStore>();
            mockLoadPhraseStore.mockReturnValue(loading.promise);
            const { result, unmount } = await renderHook(() => usePhrases(), { wrapper });

            await unmount();
            await act(async () => {
                loading.resolve(store([phrase('Late')]));
            });

            expect(result.current.ready).toBe(false);
            expect(mockSyncPhraseStore).not.toHaveBeenCalled();
        });
    });

    describe('visiblePhrases', () => {
        it('contains the first visibleCount phrases', async () => {
            const { result } = await renderPhrases(
                store([phrase('A'), phrase('B'), phrase('C')], { visibleCount: 2 }),
            );

            expect(texts(result.current.visiblePhrases)).toEqual(['A', 'B']);
        });

        it('is empty when visibleCount is 0', async () => {
            const { result } = await renderPhrases(store([phrase('A')], { visibleCount: 0 }));

            expect(result.current.visiblePhrases).toEqual([]);
        });
    });

    describe('prewarm', () => {
        it('prewarms the visible phrases with the cloud status', async () => {
            await renderPhrases(
                store([phrase('A'), phrase('B'), phrase('C'), phrase('D')]),
            );

            expect(mockPrewarmPhrases).toHaveBeenCalledTimes(1);
            expect(prewarmedTexts(0)).toEqual(['A', 'B', 'C']);
            expect(mockPrewarmPhrases.mock.calls[0].slice(1)).toEqual([true, 'v1', 'm1']);
        });

        it('does not prewarm again on a re-render', async () => {
            const { rerender } = await renderPhrases(store([phrase('A')]));

            await rerender(undefined);

            expect(mockPrewarmPhrases).toHaveBeenCalledTimes(1);
        });

        it('prewarms only the new phrase when one is added', async () => {
            const { result } = await renderPhrases(store([phrase('A')]));

            await act(async () => {
                result.current.addPhrase('B');
            });

            expect(mockPrewarmPhrases).toHaveBeenCalledTimes(2);
            expect(prewarmedTexts(1)).toEqual(['B']);
        });

        it('prewarms again after a voice change', async () => {
            const { rerender } = await renderPhrases(store([phrase('A')]));

            cloud.voice = 'v2';
            await rerender(undefined);

            expect(mockPrewarmPhrases).toHaveBeenCalledTimes(2);
            expect(mockPrewarmPhrases.mock.calls[1][2]).toBe('v2');
            expect(prewarmedTexts(1)).toEqual(['A']);
        });

        it('prewarms again after a model change', async () => {
            const { rerender } = await renderPhrases(store([phrase('A')]));

            cloud.model = 'm2';
            await rerender(undefined);

            expect(mockPrewarmPhrases).toHaveBeenCalledTimes(2);
            expect(mockPrewarmPhrases.mock.calls[1][3]).toBe('m2');
        });

        it('retries a failed prewarm on the next run', async () => {
            mockPrewarmPhrases.mockRejectedValueOnce(new Error('network'));
            const { result } = await renderPhrases(store([phrase('A')]));
            expect(mockPrewarmPhrases).toHaveBeenCalledTimes(1);

            await act(async () => {
                result.current.addPhrase('B');
            });

            expect(mockPrewarmPhrases).toHaveBeenCalledTimes(2);
            expect(prewarmedTexts(1)).toEqual(['A', 'B']);
        });

        it('does not prewarm empty or whitespace phrases', async () => {
            await renderPhrases(store([phrase(''), phrase('   '), phrase('A')]));

            expect(mockPrewarmPhrases).toHaveBeenCalledTimes(1);
            expect(prewarmedTexts(0)).toEqual(['A']);
        });

        it('does not prewarm when only empty phrases are visible', async () => {
            await renderPhrases(store([phrase('  ')]));

            expect(mockPrewarmPhrases).not.toHaveBeenCalled();
        });

        it('does not prewarm when the backend is not available', async () => {
            cloud.isAvailable = false;

            await renderPhrases(store([phrase('A')]));

            expect(mockPrewarmPhrases).not.toHaveBeenCalled();
        });

        it('does not prewarm when there are no visible phrases', async () => {
            await renderPhrases(store([phrase('A')], { visibleCount: 0 }));

            expect(mockPrewarmPhrases).not.toHaveBeenCalled();
        });

        it('prewarms once the backend becomes available', async () => {
            cloud.isAvailable = false;
            const { rerender } = await renderPhrases(store([phrase('A')]));

            cloud.isAvailable = true;
            await rerender(undefined);

            expect(mockPrewarmPhrases).toHaveBeenCalledTimes(1);
        });
    });

    describe('addPhrase', () => {
        it('adds a trimmed phrase at the end and saves it', async () => {
            const { result } = await renderPhrases(store([phrase('A')]));

            await act(async () => {
                result.current.addPhrase('  Hallo  ');
            });

            expect(result.current.phrases[1]).toEqual({
                id: 'new-id',
                text: 'Hallo',
                useCount: 0,
                createdAt: NOW,
            });
            expect(texts(lastSaved().phrases)).toEqual(['A', 'Hallo']);
            expect(lastSaved().settings).toEqual(SETTINGS);
        });

        it('ignores empty text', async () => {
            const { result } = await renderPhrases(store([phrase('A')]));

            await act(async () => {
                result.current.addPhrase('   ');
            });

            expect(texts(result.current.phrases)).toEqual(['A']);
            expect(mockSavePhraseStore).not.toHaveBeenCalled();
        });
    });

    describe('updatePhrase', () => {
        it('changes the text of one phrase (trimmed) and saves it', async () => {
            const { result } = await renderPhrases(store([phrase('A'), phrase('B')]));

            await act(async () => {
                result.current.updatePhrase('id-B', '  Neu  ');
            });

            expect(texts(result.current.phrases)).toEqual(['A', 'Neu']);
            expect(texts(lastSaved().phrases)).toEqual(['A', 'Neu']);
        });

        it('ignores empty text and keeps the old text', async () => {
            const { result } = await renderPhrases(store([phrase('A')]));

            await act(async () => {
                result.current.updatePhrase('id-A', '  ');
            });

            expect(texts(result.current.phrases)).toEqual(['A']);
            expect(mockSavePhraseStore).not.toHaveBeenCalled();
        });

        it('saves the list unchanged when the id is unknown', async () => {
            const { result } = await renderPhrases(store([phrase('A')]));

            await act(async () => {
                result.current.updatePhrase('missing', 'X');
            });

            expect(texts(result.current.phrases)).toEqual(['A']);
        });
    });

    describe('deletePhrase', () => {
        it('removes the phrase and saves the rest', async () => {
            const { result } = await renderPhrases(store([phrase('A'), phrase('B')]));

            await act(async () => {
                result.current.deletePhrase('id-A');
            });

            expect(texts(result.current.phrases)).toEqual(['B']);
            expect(texts(lastSaved().phrases)).toEqual(['B']);
        });
    });

    describe('movePhrase', () => {
        it('moves a phrase down', async () => {
            const { result } = await renderPhrases(store([phrase('A'), phrase('B'), phrase('C')]));

            await act(async () => {
                result.current.movePhrase('id-A', 1);
            });

            expect(texts(result.current.phrases)).toEqual(['B', 'A', 'C']);
            expect(texts(lastSaved().phrases)).toEqual(['B', 'A', 'C']);
        });

        it('moves a phrase up', async () => {
            const { result } = await renderPhrases(store([phrase('A'), phrase('B'), phrase('C')]));

            await act(async () => {
                result.current.movePhrase('id-C', -1);
            });

            expect(texts(result.current.phrases)).toEqual(['A', 'C', 'B']);
        });

        it('does not move the first phrase up', async () => {
            const { result } = await renderPhrases(store([phrase('A'), phrase('B')]));

            await act(async () => {
                result.current.movePhrase('id-A', -1);
            });

            expect(texts(result.current.phrases)).toEqual(['A', 'B']);
            expect(mockSavePhraseStore).not.toHaveBeenCalled();
        });

        it('does not move the last phrase down', async () => {
            const { result } = await renderPhrases(store([phrase('A'), phrase('B')]));

            await act(async () => {
                result.current.movePhrase('id-B', 1);
            });

            expect(texts(result.current.phrases)).toEqual(['A', 'B']);
            expect(mockSavePhraseStore).not.toHaveBeenCalled();
        });

        it('ignores an unknown id', async () => {
            const { result } = await renderPhrases(store([phrase('A'), phrase('B')]));

            await act(async () => {
                result.current.movePhrase('missing', 1);
            });

            expect(texts(result.current.phrases)).toEqual(['A', 'B']);
            expect(mockSavePhraseStore).not.toHaveBeenCalled();
        });
    });

    describe('reorderPhrases', () => {
        it('moves a phrase from one index to another and saves', async () => {
            const { result } = await renderPhrases(store([phrase('A'), phrase('B'), phrase('C')]));

            await act(async () => {
                result.current.reorderPhrases(0, 2);
            });

            expect(texts(result.current.phrases)).toEqual(['B', 'C', 'A']);
            expect(texts(lastSaved().phrases)).toEqual(['B', 'C', 'A']);
        });

        it('does nothing for the same or an invalid index', async () => {
            const { result } = await renderPhrases(store([phrase('A'), phrase('B')]));

            await act(async () => {
                result.current.reorderPhrases(1, 1);
                result.current.reorderPhrases(0, 5);
            });

            expect(texts(result.current.phrases)).toEqual(['A', 'B']);
            expect(mockSavePhraseStore).not.toHaveBeenCalled();
        });
    });

    describe('setVisibleCount', () => {
        it('changes the count and saves it with the phrases', async () => {
            const { result } = await renderPhrases(store([phrase('A'), phrase('B')]));

            await act(async () => {
                result.current.setVisibleCount(1);
            });

            expect(result.current.settings.visibleCount).toBe(1);
            expect(texts(result.current.visiblePhrases)).toEqual(['A']);
            expect(lastSaved().settings).toEqual({ visibleCount: 1, instantEnabled: true });
            expect(texts(lastSaved().phrases)).toEqual(['A', 'B']);
        });

        it('limits the count to the maximum', async () => {
            const { result } = await renderPhrases(store([phrase('A')], { visibleCount: 1 }));

            await act(async () => {
                result.current.setVisibleCount(10);
            });

            expect(result.current.settings.visibleCount).toBe(3);
        });

        it('limits a negative count to 0', async () => {
            const { result } = await renderPhrases(store([phrase('A')]));

            await act(async () => {
                result.current.setVisibleCount(-4);
            });

            expect(result.current.settings.visibleCount).toBe(0);
        });

        it('cuts a decimal count to a whole number', async () => {
            const { result } = await renderPhrases(store([phrase('A')]));

            await act(async () => {
                result.current.setVisibleCount(1.9);
            });

            expect(result.current.settings.visibleCount).toBe(1);
        });
    });

    describe('setInstantEnabled', () => {
        it('changes the flag and saves it', async () => {
            const { result } = await renderPhrases(store([phrase('A')]));

            await act(async () => {
                result.current.setInstantEnabled(false);
            });

            expect(result.current.settings.instantEnabled).toBe(false);
            expect(lastSaved().settings).toEqual({ visibleCount: 3, instantEnabled: false });
        });
    });

    describe('recordUse', () => {
        it('counts the use and sets the time for that phrase only', async () => {
            const { result } = await renderPhrases(store([phrase('A', 2), phrase('B', 5)]));

            await act(async () => {
                result.current.recordUse('id-A');
            });

            expect(result.current.phrases[0]).toMatchObject({ useCount: 3, lastUsedAt: NOW });
            expect(result.current.phrases[1].useCount).toBe(5);
            expect(result.current.phrases[1].lastUsedAt).toBeUndefined();
            expect(lastSaved().phrases[0].useCount).toBe(3);
        });

        it('starts at 1 when the phrase has no use count yet', async () => {
            const noCount = { id: 'x', text: 'X', createdAt: 1 } as unknown as Phrase;
            const { result } = await renderPhrases(store([noCount]));

            await act(async () => {
                result.current.recordUse('x');
            });

            expect(result.current.phrases[0].useCount).toBe(1);
        });

        it('keeps the order (no sorting by use)', async () => {
            const { result } = await renderPhrases(store([phrase('A', 0), phrase('B', 9)]));

            await act(async () => {
                result.current.recordUse('id-A');
            });

            expect(texts(result.current.phrases)).toEqual(['A', 'B']);
        });
    });
});
