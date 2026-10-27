import { authHeaders } from './supabase';

const TIMEOUT_MS = 5_000;

/** fetch() to our backend with the login token and a timeout. Throws on network or HTTP errors. */
export async function backendFetch(
    url: string,
    { method = 'GET', json }: { method?: string; json?: unknown } = {}
): Promise<Response> {
    const response = await fetch(url, {
        method,
        headers: {
            ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
            ...(await authHeaders()),
        },
        body: json !== undefined ? JSON.stringify(json) : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
}
