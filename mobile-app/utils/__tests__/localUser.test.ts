import { beforeEach, describe, expect, it } from '@jest/globals';
import { scoped, setLocalUser } from '../localUser';

beforeEach(() => {
    setLocalUser(null);
});

describe('scoped', () => {
    it('uses "signed-out" without a user', () => {
        expect(scoped('chats')).toBe('chats.signed-out');
    });

    it('adds the id of the signed-in user', () => {
        setLocalUser('u1');

        expect(scoped('chats')).toBe('chats.u1');
    });

    it('switches to the new user on an account change', () => {
        setLocalUser('u1');
        setLocalUser('u2');

        expect(scoped('phrases')).toBe('phrases.u2');
    });

    it('drops the id on sign-out', () => {
        setLocalUser('u1');
        setLocalUser(null);

        expect(scoped('chats')).toBe('chats.signed-out');
    });
});
