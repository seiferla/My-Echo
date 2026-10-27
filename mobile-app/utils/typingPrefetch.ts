import { SENTENCE_STREAMING } from './config';
import { prefetchSentence } from './tts';
import { createTypingPrefetcher, TYPING_IDLE_MS } from './typingPrefetchCore';

// Sentence prefetch while typing (rules: see typingPrefetchCore.ts).
// When the text is spoken, the sentences are usually cached already (see speak()).
export { TYPING_IDLE_MS };

const prefetcher = createTypingPrefetcher(prefetchSentence, () => SENTENCE_STREAMING);

export const onTypingChanged = prefetcher.onTypingChanged;
export const resetTypingPrefetch = prefetcher.reset;
