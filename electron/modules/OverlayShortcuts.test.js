'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    DEFAULT_OVERLAY_SHORTCUTS,
    isValidOverlayAccelerator,
    normalizeOverlayShortcuts,
    validateOverlayShortcutPair,
} = require('./OverlayShortcuts');

test('uses uncommon modifier-rich overlay defaults', () => {
    assert.equal(DEFAULT_OVERLAY_SHORTCUTS.icon, 'CommandOrControl+Alt+Shift+O');
    assert.equal(DEFAULT_OVERLAY_SHORTCUTS.overlay, 'CommandOrControl+Alt+Shift+P');
});

test('explains invalid and duplicate shortcut pairs', () => {
    assert.equal(validateOverlayShortcutPair({ icon: 'O', overlay: 'Control+P' }).valid, false);
    assert.match(validateOverlayShortcutPair({ icon: 'Control+O', overlay: 'Control+O' }).error, /different/);
    assert.equal(validateOverlayShortcutPair({ icon: 'Control+O', overlay: 'Control+P' }).valid, true);
});

test('accepts configurable keyboard accelerators and rejects unsafe values', () => {
    assert.equal(isValidOverlayAccelerator('Control+Shift+F10'), true);
    assert.equal(isValidOverlayAccelerator('CommandOrControl+Alt+K'), true);
    assert.equal(isValidOverlayAccelerator('F10'), false);
    assert.equal(isValidOverlayAccelerator('Control+Shift+NotAKey'), false);
});

test('falls back when shortcuts are invalid or identical', () => {
    assert.deepEqual(normalizeOverlayShortcuts({ icon: 'nope', overlay: 'also-nope' }), DEFAULT_OVERLAY_SHORTCUTS);
    assert.deepEqual(normalizeOverlayShortcuts({
        icon: 'Control+Shift+F10',
        overlay: 'Control+Shift+F10',
    }), DEFAULT_OVERLAY_SHORTCUTS);
});
