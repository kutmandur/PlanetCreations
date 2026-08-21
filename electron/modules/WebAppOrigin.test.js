const test = require('node:test');
const assert = require('node:assert/strict');

const {
    LEGACY_WEB_ORIGIN,
    PRODUCTION_WEB_ORIGIN,
    isProductionWebOrigin,
} = require('./WebAppOrigin');

test('starts desktop windows directly on the canonical www origin', () => {
    assert.equal(PRODUCTION_WEB_ORIGIN, 'https://www.planetcreations.net');
});

test('continues to trust only the canonical and legacy PlanetCreations origins', () => {
    assert.equal(LEGACY_WEB_ORIGIN, 'https://planetcreations.net');
    assert.equal(isProductionWebOrigin(PRODUCTION_WEB_ORIGIN), true);
    assert.equal(isProductionWebOrigin(LEGACY_WEB_ORIGIN), true);
    assert.equal(isProductionWebOrigin('https://planetcreations.net.example.com'), false);
    assert.equal(isProductionWebOrigin('http://www.planetcreations.net'), false);
});
