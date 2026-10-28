// Backend URL comes from EXPO_PUBLIC_BACKEND_URL (.env), so it can differ per build profile.
const BACKEND_BASE = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://192.168.178.21:4444';

export const BACKEND_STREAM_URL  = `${BACKEND_BASE}/stream/tts`;
export const BACKEND_HEALTH_URL  = `${BACKEND_BASE}/health`;
export const BACKEND_WARMUP_URL  = `${BACKEND_BASE}/warmup`;
export const BACKEND_CHATS_URL   = `${BACKEND_BASE}/chats`;
export const BACKEND_PHRASES_URL = `${BACKEND_BASE}/phrases`;
export const BACKEND_TTS_STATS_URL = `${BACKEND_BASE}/stats/tts`;
export const BACKEND_VOICE_URL   = `${BACKEND_BASE}/voice`;

// URL and publishable key are public by design. NEVER put the secret/service_role key here.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL || '';
export const SUPABASE_KEY = process.env.EXPO_PUBLIC_SUPABASE_KEY || '';

// Speak sentence by sentence (first one at once). Set EXPO_PUBLIC_SENTENCE_STREAMING=0 to turn off.
export const SENTENCE_STREAMING = process.env.EXPO_PUBLIC_SENTENCE_STREAMING !== '0';
