const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldShowOverlay } = require('./OverlayVisibility');

test('existing clients retain automatic game visibility by default', () => {
    assert.equal(shouldShowOverlay({ activeGameId: 'planet-coaster-2' }), true);
    assert.equal(shouldShowOverlay({ activeGameId: 'planet-zoo' }), true);
    assert.equal(shouldShowOverlay({}), false);
});
test('disabled automatic mode hides the compact overlay even with a running game', () => {
    assert.equal(shouldShowOverlay({ autoEnabled: false, activeGameId: 'planet-zoo' }), false);
    assert.equal(shouldShowOverlay({ autoEnabled: true, activeGameId: 'planet-zoo' }), true);
});
test('manual full overlay remains open independently of automatic mode and icon shortcut', () => {
    assert.equal(shouldShowOverlay({ expanded: true, iconEnabled: false, autoEnabled: false }), true);
    assert.equal(shouldShowOverlay({ expanded: false, iconEnabled: false, autoEnabled: false }), false);
});
test('keep-visible overrides automatic mode but respects the icon shortcut', () => {
    assert.equal(shouldShowOverlay({ forcedVisible: true, autoEnabled: false }), true);
    assert.equal(shouldShowOverlay({ forcedVisible: true, autoEnabled: false, iconEnabled: false }), false);
});
