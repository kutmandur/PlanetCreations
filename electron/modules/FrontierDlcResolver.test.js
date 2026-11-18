const assert = require('node:assert/strict');
const test = require('node:test');
for (const [label, resolver] of [
    ['desktop', require('./FrontierDlcResolver')],
    ['server', require('../../functions/frontierDlcResolver')],
]) {
    test(`${label}: recognizes content IDs without guessing unverified DLC bits`, () => {
        const result = resolver.resolveFrontierDlcRequirements('planet-coaster-2', 256, ['ContentPDLC6']);
        assert.deepEqual(result.requiredDlcs, ['Spooktacular Pack']);
        assert.deepEqual(result.unknownDlcBits, [8]);
        assert.deepEqual(result.unknownDlcIdentifiers, []);
        const zoo = resolver.resolveFrontierDlcRequirements('planet-zoo-2', 3, ['Deluxe']);
        assert.deepEqual(zoo.requiredDlcs, []);
        assert.deepEqual(zoo.unknownDlcBits, [0, 1]);
        assert.deepEqual(zoo.unknownDlcIdentifiers, ['Deluxe']);
        assert.deepEqual(resolver.normalizeFrontierDlcCatalog('planet-zoo-2').entries.map(e => e.name),
            ['Deluxe Upgrade Pack', 'Bonus Content Pack']);
    });
}

test('desktop and server built-in catalogs stay aligned', () => {
    const desktop = require('./FrontierDlcResolver');
    const server = require('../../functions/frontierDlcResolver');
    for (const game of ['planet-coaster-2', 'planet-zoo', 'planet-zoo-2']) {
        assert.deepEqual(desktop.normalizeFrontierDlcCatalog(game), server.normalizeFrontierDlcCatalog(game));
    }
});
const {
    PLANET_COASTER_2_DLC_BITS,
    PLANET_ZOO_DLC_BITS,
    normalizeFrontierDlcCatalog,
    resolveFrontierDlcRequirements,
    resolveFrontierDlcMask,
} = require('./FrontierDlcResolver');

test('contains the reviewed DLC catalogs', () => {
    assert.equal(PLANET_COASTER_2_DLC_BITS.length, 8);
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
