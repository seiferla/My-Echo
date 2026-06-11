import { File, Directory, Paths } from 'expo-file-system';

const TAG = '[myEcho][Cache]';
const MAX_CACHE_BYTES = 100 * 1024 * 1024;   // 100 MB hard cap
const EVICT_TARGET_BYTES = 80 * 1024 * 1024; // evict down to 80 MB
const PERSIST_DEBOUNCE_MS = 500;

interface CacheEntry {
    hash: string;
    size: number;
    createdAt: number;
    lastAccessedAt: number;
    accessCount: number;
}

interface CacheIndex {
    version: 1;
    entries: Record<string, CacheEntry>;
    totalSize: number;
    hits: number;
    misses: number;
}

export interface CacheStats {
    entries: number;
    totalSizeMB: number;
    hits: number;
    misses: number;
    hitRatePct: number;
}

const cacheDir = new Directory(Paths.document, 'tts-cache');
const indexFile = new File(cacheDir, 'index.json');

const emptyIndex = (): CacheIndex => ({
    version: 1,
    entries: {},
    totalSize: 0,
    hits: 0,
    misses: 0,
});

let _index: CacheIndex | null = null;
let _initPromise: Promise<void> | null = null;
let _persistTimer: ReturnType<typeof setTimeout> | null = null;
const _inFlight = new Map<string, Promise<string>>();
// Bumped by clearCache so in-flight downloads can detect they were invalidated
// and discard their result instead of writing into the freshly cleared index.
let _generation = 0;

// --- Hashing (64-bit FNV-1a, pure JS) ---

function hash64(str: string): string {
    let h1 = 0x811c9dc5;
    let h2 = 0xdeadbeef;
    for (let i = 0; i < str.length; i++) {
        const c = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ c, 0x811c9dc5) >>> 0;
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

// Cache-Key bindet text, voice, model und format zusammen — ein Wechsel
// von Stimme oder Modell im Backend macht alte Einträge automatisch
// unauffindbar (sie werden später durch LRU evictet).
function cacheKey(
    text: string,
    voiceId = 'default',
    model = 'default',
    format = 'mp3'
): string {
    return hash64(`${text}|${voiceId}|${model}|${format}`);
}

function cacheFile(hash: string): File {
    return new File(cacheDir, `${hash}.mp3`);
}

// --- Initialisation (lazy, deduplicated) ---

async function ensureInit(): Promise<void> {
    if (_index !== null) return;
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
        if (!cacheDir.exists) {
            cacheDir.create({ intermediates: true });
        }
        if (indexFile.exists) {
            try {
                const raw = indexFile.textSync();
                const parsed = JSON.parse(raw) as CacheIndex;
                _index = parsed.version === 1 ? parsed : emptyIndex();
            } catch {
                _index = emptyIndex();
            }
        } else {
            _index = emptyIndex();
        }
        console.log(
            `${TAG} Initialized — ${Object.keys(_index!.entries).length} entries, ` +
            `${(_index!.totalSize / 1024 / 1024).toFixed(1)} MB`
        );
    })();
    return _initPromise;
}

// --- Persistence (debounced sync write) ---

function schedulePersist(): void {
    if (_persistTimer) clearTimeout(_persistTimer);
    _persistTimer = setTimeout(() => {
        if (!_index) return;
        try {
            indexFile.write(JSON.stringify(_index));
        } catch (e) {
            console.warn(`${TAG} Index persist failed:`, e);
        }
    }, PERSIST_DEBOUNCE_MS);
}

function persistNow(): void {
    if (_persistTimer) {
        clearTimeout(_persistTimer);
        _persistTimer = null;
    }
    if (!_index) return;
    indexFile.write(JSON.stringify(_index));
}

// --- LRU Eviction ---

function evictSync(): void {
    if (!_index || _index.totalSize <= MAX_CACHE_BYTES) return;

    const lruOrder = Object.values(_index.entries).sort(
        (a, b) => a.lastAccessedAt - b.lastAccessedAt
    );

    for (const entry of lruOrder) {
        if (_index.totalSize <= EVICT_TARGET_BYTES) break;
        try {
            cacheFile(entry.hash).delete();
        } catch {}
        _index.totalSize = Math.max(0, _index.totalSize - entry.size);
        delete _index.entries[entry.hash];
        console.log(`${TAG} Evicted ${entry.hash} (${(entry.size / 1024).toFixed(0)} KB)`);
    }
    schedulePersist();
}

// --- Public API ---

export async function getCachedUri(
    text: string,
    voiceId?: string,
    model?: string,
    format?: string
): Promise<string | null> {
    await ensureInit();
    const hash = cacheKey(text, voiceId, model, format);
    const entry = _index!.entries[hash];

    if (!entry) {
        _index!.misses += 1;
        schedulePersist();
        return null;
    }

    const file = cacheFile(hash);
    // 0-Byte-Dateien (z.B. nach Abbruch zwischen create und write) wie Miss behandeln
    if (!file.exists || file.size === 0) {
        if (file.exists) {
            try { file.delete(); } catch {}
        }
        _index!.totalSize = Math.max(0, _index!.totalSize - entry.size);
        delete _index!.entries[hash];
        _index!.misses += 1;
        schedulePersist();
        return null;
    }

    entry.lastAccessedAt = Date.now();
    entry.accessCount += 1;
    _index!.hits += 1;
    schedulePersist();

    console.log(`${TAG} HIT — "${text.slice(0, 40)}" (×${entry.accessCount})`);
    return file.uri;
}

export async function downloadAndCache(
    text: string,
    url: string,
    voiceId?: string,
    model?: string,
    format?: string
): Promise<string> {
    await ensureInit();
    const hash = cacheKey(text, voiceId, model, format);

    // Deduplicate concurrent requests for the same hash
    const inflight = _inFlight.get(hash);
    if (inflight) return inflight;

    const startGen = _generation;
    const promise = (async () => {
        const dest = cacheFile(hash);

        // File.downloadFileAsync throws UnableToDownload for non-2xx responses.
        // On failure, remove any partial bytes so they don't leak as untracked disk usage.
        try {
            await File.downloadFileAsync(url, dest, { idempotent: true });
        } catch (e) {
            try { dest.delete(); } catch {}
            throw e;
        }

        // If clearCache ran while we were downloading, our bytes belong to a
        // generation that no longer exists — drop the file and fail loudly so
        // the caller falls back instead of pointing at a phantom cache entry.
        if (startGen !== _generation) {
            try { dest.delete(); } catch {}
            throw new Error('Cache cleared during download');
        }

        const size = dest.size;
        const now = Date.now();
        const prev = _index!.entries[hash];
        if (prev) {
            _index!.totalSize = Math.max(0, _index!.totalSize - prev.size);
        }
        _index!.entries[hash] = {
            hash,
            size,
            createdAt: prev ? prev.createdAt : now,
            lastAccessedAt: now,
            accessCount: prev ? prev.accessCount + 1 : 1,
        };
        _index!.totalSize += size;
        schedulePersist();

        console.log(`${TAG} Cached "${text.slice(0, 40)}" — ${(size / 1024).toFixed(0)} KB`);

        evictSync();
        return dest.uri;
    })().finally(() => _inFlight.delete(hash));

    _inFlight.set(hash, promise);
    return promise;
}

export async function getCacheStats(): Promise<CacheStats> {
    await ensureInit();
    const idx = _index!;
    const total = idx.hits + idx.misses;
    return {
        entries: Object.keys(idx.entries).length,
        totalSizeMB: parseFloat((idx.totalSize / 1024 / 1024).toFixed(2)),
        hits: idx.hits,
        misses: idx.misses,
        hitRatePct: total > 0 ? Math.round((idx.hits / total) * 100) : 0,
    };
}

export async function clearCache(): Promise<void> {
    await ensureInit();
    try {
        cacheDir.delete();
        cacheDir.create({ intermediates: true });
    } catch (e) {
        console.warn(`${TAG} Clear failed:`, e);
    }
    _index = emptyIndex();
    _initPromise = null;
    _inFlight.clear();
    // Invalidate any download IIFEs that started before this clear — they
    // check _generation after the network finishes and discard their result.
    _generation += 1;
    persistNow();
    console.log(`${TAG} Cache cleared`);
}
