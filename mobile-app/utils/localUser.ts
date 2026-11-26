// Local data has one file/key per account, e.g. "chats.<user_id>.json", so a second
// account on the same device never sees the first one's data and logout deletes nothing.
// AuthContext sets the id BEFORE the app screens read data.
let currentUserId: string | null = null;

export function setLocalUser(userId: string | null): void {
    currentUserId = userId;
}

/** "chats" → "chats.<user_id>", or "chats.signed-out" without a session. */
export function scoped(name: string): string {
    return `${name}.${currentUserId ?? 'signed-out'}`;
}
