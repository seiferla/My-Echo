import { storage } from './storage';
import { scoped } from './localUser';
import { BACKEND_TTS_STATS_URL } from './config';
import { backendFetch } from './backend';

/**
 * TTS usage per day: requests, characters and speaking time, for the stats screen.
 *
 * Stored per day (key 'YYYY-MM-DD'), so the SecureStore entry stays small,
 * and synced with the backend.
 */

const TAG = '[myEcho][TtsLog]';
const STORAGE_KEY_BASE = 'myEchoTtsStats';
// One entry per account (see localUser.ts).
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
 * Records one speech output for today.
 * @param chars number of spoken characters
 * @param durationMs length of the speech output in milliseconds
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
    void pushTtsStats({ [key]: bucket });
}

/** Per day and field the larger value wins (same as the backend), so numbers never go down. */
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

/** Never throws: the values are already stored locally. */
async function pushTtsStats(days: TtsStats): Promise<void> {
    try {
        await backendFetch(BACKEND_TTS_STATS_URL, { method: 'POST', json: days });
    } catch (e) {
        console.warn(`${TAG} Push failed:`, e);
    }
}

/** Merges local and backend stats in both directions. Never throws; offline keeps local stats. */
export async function syncTtsStats(): Promise<void> {
    try {
        const response = await backendFetch(BACKEND_TTS_STATS_URL);
        const remote = (await response.json()) as TtsStats;

        // Read local stats only after the fetch, so a request logged meanwhile is not lost.
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
