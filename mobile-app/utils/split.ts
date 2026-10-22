// Zerlegt einen Eingabetext in abgeschlossene Sätze plus einen unfertigen Rest.
// Gedacht für die Satz-Vorab-Synthese: Während der User tippt, werden nur Sätze
// synthetisiert, die mit einem Satzzeichen abgeschlossen sind — der Rest bleibt
// liegen, bis er (evtl. beim Senden) fertig ist.

// Schließende Zeichen, die direkt auf ein Satzzeichen folgen dürfen, ohne dass
// das Satzzeichen dadurch aufhört ein Satzende zu sein ("Hallo.", "Hallo!").
const CLOSING = new Set(['"', "'", '”', '“', ')', ']', '»', '„']);

export interface SentenceSplit {
    /** Abgeschlossene Sätze, getrimmt, in Reihenfolge. */
    completed: string[];
    /** Noch nicht abgeschlossener Rest, getrimmt (leer wenn Text auf Satzende endet). */
    remainder: string;
}

/**
 * Liefert die Position direkt hinter einem Satzende (Satzzeichen + schließende
 * Zeichen + folgendes Whitespace) oder null, wenn `i` kein Satzende ist.
 *
 * Kernregel: Ein `.`/`!`/`?` ist nur dann ein Satzende, wenn danach (ggf. nach
 * schließenden Quotes/Klammern) Whitespace oder Textende folgt. Das fängt mit
 * einer Regel die häufigen Fälle ab, in denen ein Punkt KEIN Satzende ist:
 * Dezimalzahlen ("3.5"), Tausenderpunkte ("1.200") und Abkürzungen ("z.B.").
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
