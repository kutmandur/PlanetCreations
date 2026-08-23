const assert = require('node:assert/strict');
const test = require('node:test');
const {
    PLANET_COASTER_2_DLC_BITS,
    PLANET_ZOO_DLC_BITS,
    normalizeFrontierDlcCatalog,
    resolveFrontierDlcRequirements,
    resolveFrontierDlcMask,
} = require('./FrontierDlcResolver');

test('contains the complete save-relevant DLC catalogs for both games', () => {
    assert.equal(PLANET_COASTER_2_DLC_BITS.length, 7);
    assert.equal(PLANET_ZOO_DLC_BITS.length, 21);
    assert.deepEqual(PLANET_ZOO_DLC_BITS[0], {
        bit: 0,
        name: 'Deluxe Upgrade Pack',
        steamAppId: 1098120,
        contentId: 'Deluxe',
    });
    assert.deepEqual(PLANET_ZOO_DLC_BITS.at(-1), {
        bit: 20,
        name: 'Asia Animal Pack',
        steamAppId: 3586990,
        contentId: 'Content20',
    });
});

test('resolves Planet Coaster 2 DLC bits to display names', () => {
    assert.deepEqual(resolveFrontierDlcMask('planet-coaster-2', 146), {
        mappingVersion: 2,
        requiredDlcs: [
            'Bonus Ride Collection',
            'Sorcery Pack',
            'Silver Screen Pack',
        ],
        requiredDlcBits: [1, 4, 7],
        unknownDlcBits: [],
        unknownDlcIdentifiers: [],
    });
});

test('resolves every known Planet Zoo slot and retains future bits', () => {
    assert.deepEqual(resolveFrontierDlcMask('planet-zoo', 7), {
        mappingVersion: 2,
        requiredDlcs: [
            'Deluxe Upgrade Pack',
            'Arctic Pack',
            'South America Pack',
        ],
        requiredDlcBits: [0, 1, 2],
        unknownDlcBits: [],
        unknownDlcIdentifiers: [],
    });

    const withFutureDlc = resolveFrontierDlcMask(
        'planet-zoo',
        (2 ** 20) + (2 ** 21),
    );
    assert.deepEqual(withFutureDlc.requiredDlcs, ['Asia Animal Pack']);
    assert.deepEqual(withFutureDlc.requiredDlcBits, [20, 21]);
    assert.deepEqual(withFutureDlc.unknownDlcBits, [21]);
});

test('uses a server catalog and resolves internal identifiers without an app update', () => {
    const catalog = normalizeFrontierDlcCatalog('planet-zoo', {
        names: ['Future Animal Pack'],
        catalogVersion: 99,
        saveMappings: {
            'Future Animal Pack': { bit: 21, identifiers: ['Content21'] },
        },
    });
    assert.deepEqual(resolveFrontierDlcRequirements(
        'planet-zoo',
        2 ** 21,
        ['Content21'],
        catalog,
    ), {
        mappingVersion: 99,
        requiredDlcs: ['Future Animal Pack'],
        requiredDlcBits: [21],
        unknownDlcBits: [],
        unknownDlcIdentifiers: [],
    });
    assert.ok(catalog.entries.some(entry => entry.name === 'Arctic Pack'));
});

test('a partial public catalog cannot remove verified built-in mappings', () => {
    const partialCatalog = {
        version: 100,
        entries: [{ name: 'Future Animal Pack', bit: 21, identifiers: ['Content21'] }],
    };
    assert.deepEqual(resolveFrontierDlcRequirements(
        'planet-zoo',
        (2 ** 1) + (2 ** 21),
        ['Content1', 'Content21'],
        partialCatalog,
    ).requiredDlcs, ['Arctic Pack', 'Future Animal Pack']);
});
