import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Sidebar } from '../Sidebar';
import type { Chat } from '../../utils/types';

// ---- Fakes ----

// Icons are only decoration; the ESM build of lucide cannot be loaded by jest.
jest.mock('lucide-react-native', () => new Proxy({}, { get: () => () => null }));


const mockPush = jest.fn();
jest.mock('expo-router', () => ({
    useRouter: () => ({ push: mockPush }),
}));

jest.mock('../../context/AuthContext', () => ({
    useAuth: () => ({ session: { user: { email: 'anna@example.com' } } }),
}));

// ---- Helpers ----

function chat(id: string, title: string, pinned = false): Chat {
    return { id, title, messages: [], timestamp: Date.now(), pinned };
}

const CHATS = [chat('c1', 'Einkaufen'), chat('c2', 'Arzttermin')];

const handlers = {
    onSelectChat: jest.fn(),
    onNewChat: jest.fn(),
    onPinChat: jest.fn(),
    onRenameChat: jest.fn(),
    onDeleteChat: jest.fn(),
    onClose: jest.fn(),
};

async function renderSidebar(chats: Chat[] = CHATS) {
    await render(<Sidebar chats={chats} currentChatId="c1" {...handlers} />);
}

async function openMenu(title: string) {
    await fireEvent(screen.getByText(title), 'longPress');
}

describe('Sidebar', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('top actions and footer', () => {
        it('"Neuer Chat" calls onNewChat', async () => {
            await renderSidebar();
            await fireEvent.press(screen.getByRole('button', { name: 'Neuer Chat' }));
            expect(handlers.onNewChat).toHaveBeenCalledTimes(1);
        });

        it('"Phrasen" closes the drawer and opens /phrases', async () => {
            await renderSidebar();
            await fireEvent.press(screen.getByRole('button', { name: /Phrasen/ }));
            expect(handlers.onClose).toHaveBeenCalledTimes(1);
            expect(mockPush).toHaveBeenCalledWith('/phrases');
        });

        it('"Einstellungen" closes the drawer and opens /settings', async () => {
            await renderSidebar();
            await fireEvent.press(screen.getByRole('button', { name: /Einstellungen/ }));
            expect(handlers.onClose).toHaveBeenCalledTimes(1);
            expect(mockPush).toHaveBeenCalledWith('/settings');
        });

        it('shows the email in the settings row', async () => {
            await renderSidebar();
            expect(screen.getByText('anna@example.com')).toBeTruthy();
        });

        it.each(['Statistik', 'Stimme', 'Abmelden', 'Konto löschen'])(
            'no longer has "%s" in the drawer',
            async (label) => {
                await renderSidebar();
                expect(screen.queryByText(new RegExp(label))).toBeNull();
                expect(screen.queryByRole('button', { name: new RegExp(label) })).toBeNull();
            }
        );
    });

    describe('chat list', () => {
        it('selecting a chat calls onSelectChat and onClose', async () => {
            await renderSidebar();
            await fireEvent.press(screen.getByText('Arzttermin'));
            expect(handlers.onSelectChat).toHaveBeenCalledWith('c2');
            expect(handlers.onClose).toHaveBeenCalledTimes(1);
        });

        it('long press shows the context menu', async () => {
            await renderSidebar();
            await openMenu('Einkaufen');
            expect(screen.getByText('Anheften')).toBeTruthy();
            expect(screen.getByText('Umbenennen')).toBeTruthy();
            expect(screen.getByText('Löschen')).toBeTruthy();
        });

        it('"Anheften" calls onPinChat with the chat id', async () => {
            await renderSidebar();
            await openMenu('Einkaufen');
            await fireEvent.press(screen.getByText('Anheften'));
            expect(handlers.onPinChat).toHaveBeenCalledWith('c1');
        });

        it('offers "Anheften aufheben" for a pinned chat', async () => {
            await renderSidebar([chat('c1', 'Einkaufen', true)]);
            await openMenu('Einkaufen');
            expect(screen.getByText('Anheften aufheben')).toBeTruthy();
        });

        it('renames a chat with the trimmed title', async () => {
            await renderSidebar();
            await openMenu('Einkaufen');
            await fireEvent.press(screen.getByText('Umbenennen'));
            const input = screen.getByDisplayValue('Einkaufen');
            await fireEvent.changeText(input, '  Wocheneinkauf  ');
            await fireEvent.press(screen.getByText('Speichern'));
            expect(handlers.onRenameChat).toHaveBeenCalledWith('c1', 'Wocheneinkauf');
        });

        it('does not rename when the new title is empty', async () => {
            await renderSidebar();
            await openMenu('Einkaufen');
            await fireEvent.press(screen.getByText('Umbenennen'));
            await fireEvent.changeText(screen.getByDisplayValue('Einkaufen'), '   ');
            await fireEvent.press(screen.getByText('Speichern'));
            expect(handlers.onRenameChat).not.toHaveBeenCalled();
        });

        it('"Löschen" asks first, and only the destructive button deletes', async () => {
            const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
            await renderSidebar();
            await openMenu('Einkaufen');
            await fireEvent.press(screen.getByText('Löschen'));

            expect(alertSpy).toHaveBeenCalledTimes(1);
            expect(handlers.onDeleteChat).not.toHaveBeenCalled();

            const buttons = alertSpy.mock.calls[0][2] as { text: string; style?: string; onPress?: () => void }[];
            const destructive = buttons.find((b) => b.style === 'destructive');
            expect(destructive?.text).toBe('Löschen');
            destructive?.onPress?.();
            expect(handlers.onDeleteChat).toHaveBeenCalledWith('c1');
            alertSpy.mockRestore();
        });

        it('cancelling the delete alert does not delete', async () => {
            const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
            await renderSidebar();
            await openMenu('Einkaufen');
            await fireEvent.press(screen.getByText('Löschen'));
            const buttons = alertSpy.mock.calls[0][2] as { style?: string; onPress?: () => void }[];
            buttons.find((b) => b.style === 'cancel')?.onPress?.();
            expect(handlers.onDeleteChat).not.toHaveBeenCalled();
            alertSpy.mockRestore();
        });
    });
});
