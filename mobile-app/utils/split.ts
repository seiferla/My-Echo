// Splits an input text into finished sentences plus an unfinished rest.
// Used by the sentence prefetch: while the user types, only sentences that end
// with a punctuation mark are synthesized; the rest waits (maybe until send).

// Closing characters that may follow the punctuation mark and still keep it a
// sentence end (e.g. a closing quote or bracket).
const CLOSING = new Set(['"', "'", '”', '“', ')', ']', '»', '„']);

export interface SentenceSplit {
    /** Finished sentences, trimmed, in order. */
    completed: string[];
    /** Unfinished rest, trimmed (empty when the text ends with a sentence end). */
    remainder: string;
}

/**
 * Returns the position right after a sentence end (punctuation + closing chars
 * + following whitespace), or null when `i` is not a sentence end.
 *
 * Rule: `.`/`!`/`?` ends a sentence only when whitespace or the end of the text
 * follows (maybe after closing quotes/brackets). This one rule handles the
 * common cases where a period is NOT a sentence end: decimals ("3.5"),
 * thousands ("1.200") and abbreviations ("z.B.").
 */
function scanSentenceEnd(text: string, i: number): number | null {
    let j = i + 1;
    while (j < text.length && CLOSING.has(text[j])) j++;
    if (j < text.length && !/\s/.test(text[j])) return null;
    while (j < text.length && /\s/.test(text[j])) j++;
    return j;
}

export function splitCompletedSentences(text: string): SentenceSplit {
    const completed: string[] = [];
    let start = 0;
    const n = text.length;

    for (let i = 0; i < n; i++) {
        const c = text[i];
        if (c !== '.' && c !== '!' && c !== '?') continue;

        const end = scanSentenceEnd(text, i);
        if (end === null) continue;

        const sentence = text.slice(start, end).trim();
        if (sentence.length > 0) completed.push(sentence);

        start = end;
        i = end - 1;
    }

    return { completed, remainder: text.slice(start).trim() };
}
