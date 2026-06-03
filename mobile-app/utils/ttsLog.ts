import { storage } from './storage';

/**
 * Lokales Logging der Sprachausgaben (TTS).
 *
 * Hinweis: Aktuell läuft die Sprachausgabe über expo-speech (on-device),
 * es entstehen also keine echten API-Kosten. Wir protokollieren trotzdem
 * Requests, synthetisierte Zeichen und die Sprechdauer, damit der
 * "API/TTS"-Bereich der Statistik echte Zahlen zeigt. Sobald die App auf
 * das vLLM-Backend umgestellt wird, kann dieselbe Funktion dort aufgerufen
 * werden (z.B. mit gemessener Latenz).
 *
 * Gespeichert wird tagesweise aggregiert (Key 'YYYY-MM-DD'), damit der
 * SecureStore-Eintrag dauerhaft klein bleibt.
 */

const STORAGE_KEY = 'myEchoTtsStats';

export interface TtsDayStat {
    requests: number;
    chars: number;
    durationMs: number;
}

export type TtsStats = Record<string, TtsDayStat>;

export function dayKey(ts: number): string {
    const d = new Date(ts);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

export async function getTtsStats(): Promise<TtsStats> {
    const raw = await storage.getItem(STORAGE_KEY);
    if (!raw) return {};
    try {
        return JSON.parse(raw) as TtsStats;
    } catch {
        return {};
    }
}

/**
 * Protokolliert eine Sprachausgabe für den heutigen Tag.
 * @param chars Anzahl synthetisierter Zeichen
 * @param durationMs Dauer der Sprachausgabe in Millisekunden
 */
export async function recordTtsRequest(chars: number, durationMs: number): Promise<void> {
    const stats = await getTtsStats();
    const key = dayKey(Date.now());
    const bucket = stats[key] ?? { requests: 0, chars: 0, durationMs: 0 };

    bucket.requests += 1;
    bucket.chars += Math.max(0, chars);
    bucket.durationMs += Math.max(0, durationMs);

    stats[key] = bucket;
    await storage.setItem(STORAGE_KEY, JSON.stringify(stats));
}