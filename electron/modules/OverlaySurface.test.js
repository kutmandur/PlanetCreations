const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { OverlaySurface } = require('./OverlaySurface');

function fixture() {
    const screen = new EventEmitter();
    let displays = [{ id: 2, bounds: { x: -1920, y: 0, width: 1920, height: 1080 } }];
    screen.getDisplayMatching = () => displays[0];
    screen.getAllDisplays = () => displays;
    screen.getPrimaryDisplay = () => displays[0];
    const window = new EventEmitter();
    let nativeBounds = { x: -200, y: 300, width: 100, height: 100 };
    const moves = [], shapes = [], messages = [];
    window.getBounds = () => ({ ...nativeBounds });
    window.setBounds = value => { nativeBounds = { ...value }; moves.push(value); };
    window.isDestroyed = () => false;
    window.setShape = value => shapes.push(value);
    window.setResizable = () => {};
    window.setHasShadow = () => {};
    window.webContents = { send: (...args) => messages.push(args) };
    const surface = new OverlaySurface(window, screen);
    surface.sync();
    return { surface, screen, window, moves, shapes, messages, setDisplays: value => { displays = value; } };
}

test('moving, expanding and collapsing content preserve the full-monitor capture bounds', () => {
    const f = fixture();
    assert.deepEqual(f.surface.layout(), { x: 1720, y: 300, width: 100, height: 100 });
    f.surface.setBounds({ x: -1500, y: 100, width: 980, height: 780 });
    f.surface.setBounds({ x: -1800, y: 200, width: 180, height: 180 });
    assert.equal(f.moves.length, 1);
    assert.deepEqual(f.window.getBounds(), { x: -1920, y: 0, width: 1920, height: 1080 });
    assert.deepEqual(f.shapes.at(-1), [{ x: 120, y: 200, width: 180, height: 180 }]);
});

test('monitor removal clamps content to the remaining display and removes listeners on close', () => {
    const f = fixture();
    f.setDisplays([{ id: 1, bounds: { x: 0, y: 0, width: 1280, height: 720 } }]);
    f.screen.emit('display-removed');
    assert.deepEqual(f.surface.getBounds(), { x: 0, y: 300, width: 100, height: 100 });
    f.surface.setBounds({ x: 400, y: 400, width: 2000, height: 1200 });
    assert.deepEqual(f.surface.layout(), { x: 0, y: 0, width: 1280, height: 720 });
    f.window.emit('closed');
    assert.equal(f.screen.listenerCount('display-metrics-changed'), 0);
    assert.equal(f.screen.listenerCount('display-removed'), 0);
});
