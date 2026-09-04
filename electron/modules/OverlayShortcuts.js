'use strict';

const DEFAULT_OVERLAY_SHORTCUTS = Object.freeze({
    icon: 'CommandOrControl+Alt+Shift+O',
    overlay: 'CommandOrControl+Alt+Shift+P',
});

const MODIFIER_PATTERN = /^(CommandOrControl|Command|Control|Ctrl|Alt|Option|AltGr|Shift|Super|Meta)$/i;
const KEY_PATTERN = /^(?:[A-Z0-9]|F(?:[1-9]|1[0-9]|2[0-4])|Space|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right)$/i;

function isValidOverlayAccelerator(value) {
    if (typeof value !== 'string' || value.length > 80) return false;
    const parts = value.split('+').map((part) => part.trim()).filter(Boolean);
    if (parts.length < 2) return false;
    const key = parts.at(-1);
    const modifiers = parts.slice(0, -1);
    return KEY_PATTERN.test(key) && modifiers.every((part) => MODIFIER_PATTERN.test(part));
}

function normalizeOverlayShortcuts(value = {}) {
    const icon = isValidOverlayAccelerator(value.icon) ? value.icon : DEFAULT_OVERLAY_SHORTCUTS.icon;
    const overlay = isValidOverlayAccelerator(value.overlay) ? value.overlay : DEFAULT_OVERLAY_SHORTCUTS.overlay;
    return icon === overlay ? { ...DEFAULT_OVERLAY_SHORTCUTS } : { icon, overlay };
}

function validateOverlayShortcutPair(value = {}) {
    if (!isValidOverlayAccelerator(value.icon) || !isValidOverlayAccelerator(value.overlay)) {
        return { valid: false, error: 'Each shortcut needs at least one modifier and a supported key.' };
    }
    if (value.icon === value.overlay) {
        return { valid: false, error: 'The icon and full overlay need different shortcuts.' };
    }
    return { valid: true };
}

module.exports = {
    DEFAULT_OVERLAY_SHORTCUTS,
    isValidOverlayAccelerator,
    normalizeOverlayShortcuts,
    validateOverlayShortcutPair,
};
