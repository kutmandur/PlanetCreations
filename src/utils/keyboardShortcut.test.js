import { describe, expect, it } from 'vitest';
import { acceleratorFromKeyboardEvent, displayAccelerator } from './keyboardShortcut';

describe('overlay keyboard shortcuts', () => {
    it('converts modified keys into Electron accelerators', () => {
        expect(acceleratorFromKeyboardEvent({ key: 'o', ctrlKey: true, altKey: true, shiftKey: true, metaKey: false }))
            .toBe('CommandOrControl+Alt+Shift+O');
        expect(acceleratorFromKeyboardEvent({ key: 'F10', ctrlKey: true, altKey: false, shiftKey: true, metaKey: false }))
            .toBe('CommandOrControl+Shift+F10');
    });

    it('ignores modifier-only and unmodified keys', () => {
        expect(acceleratorFromKeyboardEvent({ key: 'Control', ctrlKey: true })).toBeNull();
        expect(acceleratorFromKeyboardEvent({ key: 'O' })).toBeNull();
    });

    it('formats accelerators for users', () => {
        expect(displayAccelerator('CommandOrControl+Alt+Shift+O')).toBe('Ctrl/Cmd + Alt + Shift + O');
    });
});
