const test = require('node:test');
const assert = require('node:assert/strict');
const {gameForFile} = require('./GameFileTypes');
const {normalizeFrontierMetadata} = require('./FrontierSaveParser');
const {isFrontierSavePath} = require('./FrontierSaveIndexWatcher');
test('Zoo 2 shared park extension uses an exact directory segment', () => {
    assert.equal(gameForFile('C:/Frontier/Planet Zoo 2/123/Saves/test.zoo'),'planet-zoo-2');
    assert.equal(gameForFile('C:/Frontier/Planet Zoo/123/Saves/test.zoo'),'planet-zoo');
    assert.equal(gameForFile('test.zoo','planet-zoo-2'),'planet-zoo-2');
    assert.equal(gameForFile('test.park2','planet-zoo-2'),null);
});
test('Zoo 2 blueprint is classified and watched without accepting sidecars', () => {
    assert.equal(gameForFile('test.zblpr'),'planet-zoo-2');
    assert.equal(normalizeFrontierMetadata({tBlueprint:{}},'test.zblpr').kind,'blueprint');
    assert.equal(isFrontierSavePath('Planet Zoo 2/123/Saves/test.zblpr'),true);
    assert.equal(isFrontierSavePath('Planet Zoo 2/123/Saves/test.planethb'),false);
});
