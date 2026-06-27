// Zentrale Konfiguration — Backend-URL hier anpassen wenn sich IP/Port ändert.
const BACKEND_BASE = 'http://192.168.178.21:4444';

export const BACKEND_STREAM_URL  = `${BACKEND_BASE}/stream/tts`;
export const BACKEND_HEALTH_URL  = `${BACKEND_BASE}/health`;
export const BACKEND_WARMUP_URL  = `${BACKEND_BASE}/warmup`;
export const BACKEND_CHATS_URL   = `${BACKEND_BASE}/chats`;
