'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
    DEFAULT_OVERLAY_SHORTCUTS,
    isValidOverlayAccelerator,
    normalizeOverlayShortcuts,
    validateOverlayShortcutPair,
    applyOverlayShortcuts,
} = require('./OverlayShortcuts');

test('uses uncommon modifier-rich overlay defaults', () => {
    assert.equal(DEFAULT_OVERLAY_SHORTCUTS.icon, 'CommandOrControl+Alt+Shift+O');
    assert.equal(DEFAULT_OVERLAY_SHORTCUTS.overlay, 'CommandOrControl+Alt+Shift+P');
});

for (const failure of ['conflict', 'native exception', 'disk full']) {
    test(`restores both previous shortcuts after ${failure}`, () => {
        const current = { ...DEFAULT_OVERLAY_SHORTCUTS };
        const next = { icon: 'Control+K', overlay: 'Control+L' };
        const active = new Map(Object.values(current).map(value => [value, () => {}]));
        let writes = 0;
        const registry = {
            unregister: value => active.delete(value),
            register: (value, callback) => {
                if (value === next.overlay && failure === 'conflict') return false;
                if (value === next.overlay && failure === 'native exception') throw new Error('Native registration failed');
                active.set(value, callback);
                return true;
            },
        };
        assert.throws(() => applyOverlayShortcuts({ current, next, registry,
            callbacks: { icon: () => {}, overlay: () => {} },
            save: () => { writes++; throw new Error('Disk full'); },
        }));
        assert.deepEqual([...active.keys()].sort(), Object.values(current).sort());
        assert.equal(writes, failure === 'disk full' ? 1 : 0);
    });
}
test('activates and persists a new shortcut pair exactly once', () => {
    const next = { icon: 'Control+K', overlay: 'Control+L' };
    let saved, writes = 0;
    const active = new Set(Object.values(DEFAULT_OVERLAY_SHORTCUTS));
    const result = applyOverlayShortcuts({ current: DEFAULT_OVERLAY_SHORTCUTS, next,
        registry: { unregister: value => active.delete(value), register: value => { active.add(value); return true; } },
        callbacks: { icon: () => {}, overlay: () => {} }, save: value => { saved = value; writes++; },
    });
    assert.deepEqual(result, next);
    assert.deepEqual(saved, next);
    assert.equal(writes, 1);
    assert.deepEqual([...active].sort(), Object.values(next).sort());
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
