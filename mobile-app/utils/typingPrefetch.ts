import { SENTENCE_STREAMING } from './config';
import { prefetchSentence } from './tts';
import { createTypingPrefetcher, TYPING_IDLE_MS } from './typingPrefetchCore';

// Satz-Vorab-Synthese während des Tippens (Regeln: siehe typingPrefetchCore.ts).
// Beim Sprechen liegen die Sätze dann meist schon im Cache (siehe speak()).
export { TYPING_IDLE_MS };

const prefetcher = createTypingPrefetcher(prefetchSentence, () => SENTENCE_STREAMING);

export const onTypingChanged = prefetcher.onTypingChanged;
export const resetTypingPrefetch = prefetcher.reset;
