import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import SettingsScreen from '../app/settings';

// Note: this test lives outside app/, because expo-router turns every file in app/ into a route.

// ---- Fakes ----

// Icons are only decoration; the ESM build of lucide cannot be loaded by jest.
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));


const mockPush = jest.fn();
const mockBack = jest.fn();
jest.mock('expo-router', () => {
    const { useEffect } = require('react');
    return {
        useRouter: () => ({ push: mockPush, back: mockBack }),
        // Runs the callback on mount, like useEffect.
        useFocusEffect: (cb: () => void) => useEffect(cb, [cb]),
    };
});

const mockSignOut = jest.fn<() => Promise<void>>();
const mockDeleteAccount = jest.fn<() => Promise<string | null>>();
jest.mock('../context/AuthContext', () => ({
    useAuth: () => ({
        session: { user: { email: 'anna@example.com' } },
        signOut: mockSignOut,
        deleteAccount: mockDeleteAccount,
    }),
}));

const mockFetchVoice = jest.fn<() => Promise<unknown>>();
jest.mock('../utils/voice', () => ({ fetchVoice: () => mockFetchVoice() }));

const mockConfirmAction = jest.fn<
    (title: string, message: string, label: string, onConfirm: () => void) => void
>();
jest.mock('../utils/confirm', () => ({
    confirmAction: (title: string, message: string, label: string, onConfirm: () => void) =>
        mockConfirmAction(title, message, label, onConfirm),
}));

// ---- Helpers ----

async function renderScreen() {
    await render(<SettingsScreen />);
}

async function press(label: string) {
    await fireEvent.press(screen.getByRole('button', { name: new RegExp(`^${label}`) }));
}

/** The callback that the screen gave to confirmAction. */
function confirmCallback(): () => void {
    return mockConfirmAction.mock.calls[0][3];
}

describe('SettingsScreen', () => {
    beforeEach(() => {
        jest.clearAllMocks();
        mockFetchVoice.mockResolvedValue(null);
        mockSignOut.mockResolvedValue(undefined);
        mockDeleteAccount.mockResolvedValue(null);
    });

    describe('voice status', () => {
        it('shows "Eigene Stimme aktiv" when the user has a voice', async () => {
            mockFetchVoice.mockResolvedValue({ id: 'v1' });
            await renderScreen();
            expect(await screen.findByText('Eigene Stimme aktiv')).toBeTruthy();
            expect(screen.queryByText('Standardstimme')).toBeNull();
        });

        it('shows "Standardstimme" when the user has no voice', async () => {
            mockFetchVoice.mockResolvedValue(null);
            await renderScreen();
            expect(await screen.findByText('Standardstimme')).toBeTruthy();
            expect(screen.queryByText('Eigene Stimme aktiv')).toBeNull();
        });

        it('shows no status when the request fails', async () => {
            mockFetchVoice.mockRejectedValue(new Error('offline'));
            await renderScreen();
            await waitFor(() => expect(mockFetchVoice).toHaveBeenCalled());
            expect(screen.queryByText('Eigene Stimme aktiv')).toBeNull();
            expect(screen.queryByText('Standardstimme')).toBeNull();
        });
    });

    it('shows the email from the session', async () => {
        await renderScreen();
        expect(screen.getByText('anna@example.com')).toBeTruthy();
    });

    describe('navigation', () => {
        it('opens the voice screen from "Meine Stimme"', async () => {
            await renderScreen();
            await press('Meine Stimme');
            expect(mockPush).toHaveBeenCalledWith('/voice');
        });

        it('opens the stats screen from "Statistik"', async () => {
            await renderScreen();
            await press('Statistik');
            expect(mockPush).toHaveBeenCalledWith('/stats');
        });

        it('goes back with the back button', async () => {
            await renderScreen();
            await press('Zurück');
            expect(mockBack).toHaveBeenCalledTimes(1);
        });
    });

    describe('sign out', () => {
        it('asks for confirmation first and does not sign out yet', async () => {
            await renderScreen();
            await press('Abmelden');
            expect(mockConfirmAction).toHaveBeenCalledTimes(1);
            expect(mockConfirmAction.mock.calls[0][0]).toBe('Abmelden');
            expect(mockSignOut).not.toHaveBeenCalled();
        });

        it('signs out when the user confirms', async () => {
            await renderScreen();
            await press('Abmelden');
            confirmCallback()();
            expect(mockSignOut).toHaveBeenCalledTimes(1);
        });
    });

    describe('delete account', () => {
        it('asks for confirmation first and does not delete yet', async () => {
            await renderScreen();
            await press('Konto löschen');
            expect(mockConfirmAction).toHaveBeenCalledTimes(1);
            expect(mockConfirmAction.mock.calls[0][0]).toBe('Konto löschen');
            expect(mockDeleteAccount).not.toHaveBeenCalled();
        });

        it('deletes the account when the user confirms, without an alert on success', async () => {
            const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
            await renderScreen();
            await press('Konto löschen');
            confirmCallback()();
            await waitFor(() => expect(mockDeleteAccount).toHaveBeenCalledTimes(1));
            await Promise.resolve();
            expect(alertSpy).not.toHaveBeenCalled();
            alertSpy.mockRestore();
        });

        it('shows an alert with the error when deleting fails', async () => {
            const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
            mockDeleteAccount.mockResolvedValue('Server nicht erreichbar.');
            await renderScreen();
            await press('Konto löschen');
            confirmCallback()();
            await waitFor(() =>
                expect(alertSpy).toHaveBeenCalledWith(
                    'Konto löschen fehlgeschlagen',
                    'Server nicht erreichbar.'
                )
            );
            alertSpy.mockRestore();
        });
    });
});
