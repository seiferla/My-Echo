import { storage } from './storage';
import { scoped } from './localUser';
import { BACKEND_TTS_STATS_URL } from './config';
import { authHeaders } from './supabase';

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

const STORAGE_KEY_BASE = 'myEchoTtsStats';
// Pro Konto ein eigener Eintrag (siehe localUser.ts).
const storageKey = () => scoped(STORAGE_KEY_BASE);

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
    const raw = await storage.getItem(storageKey());
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
    await storage.setItem(storageKey(), JSON.stringify(stats));
    pushTtsStats({ [key]: bucket });
}

const TAG = '[myEcho][TtsLog]';
const SYNC_TIMEOUT_MS = 5_000;

/** Pro Tag und Feld gilt der größere Wert (wie im Backend): die Zahlen werden nie kleiner. */
function mergeStats(a: TtsStats, b: TtsStats): TtsStats {
    const merged: TtsStats = { ...a };
    for (const [day, s] of Object.entries(b)) {
        const own = merged[day];
        merged[day] = own
            ? {
                  requests: Math.max(own.requests, s.requests),
                  chars: Math.max(own.chars, s.chars),
                  durationMs: Math.max(own.durationMs, s.durationMs),
              }
            : s;
    }
    return merged;
}

const sameStat = (a?: TtsDayStat, b?: TtsDayStat) =>
    !!a && !!b && a.requests === b.requests && a.chars === b.chars && a.durationMs === b.durationMs;

/** Schickt Tageswerte ins Backend. Wirft NICHT: lokal gespeichert ist bereits. */
async function pushTtsStats(days: TtsStats): Promise<void> {
    try {
        const response = await fetch(BACKEND_TTS_STATS_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
            body: JSON.stringify(days),
            signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
    } catch (e) {
        console.warn(`${TAG} Push failed:`, e);
    }
}

/**
 * Gleicht die lokale Statistik mit dem Backend ab (z. B. beim Öffnen der
 * Statistikseite): Backend-Tage übernehmen, lokal Neueres hochschicken.
 * Wirft NICHT. Offline bleibt einfach der lokale Stand.
 */
export async function syncTtsStats(): Promise<void> {
    try {
        const response = await fetch(BACKEND_TTS_STATS_URL, {
            headers: await authHeaders(),
            signal: AbortSignal.timeout(SYNC_TIMEOUT_MS),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const remote = (await response.json()) as TtsStats;

        // Lokalen Stand erst NACH dem Abruf lesen: so geht eine Sprachausgabe,
        // die währenddessen protokolliert wurde, nicht verloren.
        const local = await getTtsStats();
        const merged = mergeStats(local, remote);
        if (JSON.stringify(merged) !== JSON.stringify(local)) {
            await storage.setItem(storageKey(), JSON.stringify(merged));
        }

        const toPush: TtsStats = {};
        for (const [day, s] of Object.entries(merged)) {
            if (!sameStat(s, remote[day])) toPush[day] = s;
        }
        if (Object.keys(toPush).length > 0) await pushTtsStats(toPush);
    } catch (e) {
        console.warn(`${TAG} Sync failed, keeping local stats:`, e);
    }
}