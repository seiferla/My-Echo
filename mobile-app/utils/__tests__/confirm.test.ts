import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Alert } from 'react-native';
import { confirmAction } from '../confirm';

type AlertButton = { text?: string; onPress?: () => void };

afterEach(() => {
    jest.restoreAllMocks();
});

function openDialog(onConfirm: () => void, onCancel?: () => void): AlertButton[] {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    confirmAction('Titel', 'Text', 'Löschen', onConfirm, onCancel);
    return alert.mock.calls[0][2] as AlertButton[];
}

describe('confirmAction (native)', () => {
    it('runs onConfirm only from the confirm button', () => {
        const onConfirm = jest.fn();
        const [cancel, confirm] = openDialog(onConfirm);

        cancel.onPress?.();
        expect(onConfirm).not.toHaveBeenCalled();

        confirm.onPress?.();
        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(confirm.text).toBe('Löschen');
    });

    it('runs onCancel from the cancel button', () => {
        const onCancel = jest.fn();
        const [cancel] = openDialog(jest.fn(), onCancel);

        cancel.onPress?.();
        expect(onCancel).toHaveBeenCalledTimes(1);
        expect(cancel.text).toBe('Abbrechen');
    });
});
