// Zentrale Konfiguration — Backend-URL kommt aus EXPO_PUBLIC_BACKEND_URL (.env,
// siehe .env.example). So landet die private LAN-IP nicht im Quellcode und
// kann pro Build-Profil (dev/preview/production) unterschiedlich sein, ohne
// dass config.ts angefasst werden muss.
const BACKEND_BASE = process.env.EXPO_PUBLIC_BACKEND_URL || 'http://192.168.178.21:4444';

export const BACKEND_STREAM_URL  = `${BACKEND_BASE}/stream/tts`;
export const BACKEND_HEALTH_URL  = `${BACKEND_BASE}/health`;
export const BACKEND_WARMUP_URL  = `${BACKEND_BASE}/warmup`;
export const BACKEND_CHATS_URL   = `${BACKEND_BASE}/chats`;
