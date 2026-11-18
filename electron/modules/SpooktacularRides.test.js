const test = require('node:test');
const assert = require('node:assert/strict');
const parsers = [require('./CobraSaveMetadata'), require('../../functions/cobraSaveMetadata')];
function client(name, version, count, hex = '') {
    return Buffer.concat([Buffer.from('<<ClientClient>>\xf3' + name + '\0', 'latin1'),
        Buffer.from([version, count]), Buffer.from(hex, 'hex')]);
}
function payload(strings, clients) {
    return Buffer.concat([Buffer.from('CobraSavStrings>'), Buffer.from([strings.length]),
        ...strings.map(s => Buffer.from('\xf3' + s + '\0', 'latin1')),
        Buffer.from('WString>\0'), ...clients]);
}
const types = [
    ['CC_Spectre', 'Spectre', 'coaster'],
    ['CC_SledgeCoaster', 'Sledge', 'coaster'],
    ['FR_Ballista', 'Ballista', 'flat-ride'],
    ['FR_HorrorHeights', 'Horror Heights', 'dark-ride'],
    ['FR_RumpusRoom', 'Rumpus Room', 'flat-ride'],
    ['PTR_InvertedDarkRide', 'Bosetti', 'dark-ride'],
    ['PTR_Huntsman', 'The Huntsman', 'dark-ride'],
];
for (const [index, parser] of parsers.entries()) {
    for (const [type, name, category] of types) {
        test(index + ': extracts ' + type + ' with verified name/category', () => {
            const flat = type.startsWith('FR_');
            const b = payload([type, 'User ride name'], [flat ? client('FlatRide', 41, 1, '00') :
                client('Track', 103, 1, '0000f9ffffffffffffffff010100c0c801010000f300')]);
            const result = parser.parseCobraSaveMetadata(b, 'blueprint');
            assert.equal(result.rides[0].typeId, type);
            assert.equal(result.rides[0].category, name);
            assert.equal(result.rides[0].rideCategoryKey, category);
            if (!flat) assert.equal(result.rides[0].name, 'User ride name');
        });
    }
    test(index + ': detects walkthrough stations without counting checkpoints or scenery', () => {
        // Minimal observed station record from the shipped HauntedHouse1 blueprint.
        const station = client('PartDataWalkthroughExperienceStation', 3, 1, 'c4c10f00000000000000');
        const checkpoint = client('PartDataWalkthroughExperienceCheckpoint', 1, 3, '03003c02003c04003c');
        for (const kind of ['blueprint', 'park', 'autosave']) {
            const r = parser.parseCobraSaveMetadata(payload([], [station, checkpoint]), kind, { excitement: 5 });
            assert.equal(r.rideCount, 1);
            assert.equal(r.walkthroughCount, 1);
            assert.equal(r.trackedRideCount, 0);
            assert.equal(r.flatRideCount, 0);
            assert.equal(r.rides[0].rideCategoryKey, 'walkthrough');
            assert.equal(r.rides[0].ratings, null);
        }
        const scenery = parser.parseCobraSaveMetadata(payload([], [checkpoint,
            client('PartDataWalkthroughExperienceStation', 3, 0)]), 'blueprint');
        assert.equal(scenery.rideCount, 0);
        assert.deepEqual(scenery.rides, []);
    });
    test(index + ': ignores truncated and unsupported station records', () => {
        for (const [version, data] of [[3, ''], [99, 'c4c10f00000000000000']]) {
            const r = parser.parseCobraSaveMetadata(payload([], [
                client('PartDataWalkthroughExperienceStation', version, 1, data),
            ]), 'blueprint');
            assert.equal(r.walkthroughCount, 0);
        }
    });
    test(index + ': does not double count walkthroughs already in the Ride total', () => {
        const r = parser.parseCobraSaveMetadata(payload([], [
            client('Ride', 9, 1),
            client('PartDataWalkthroughExperienceStation', 1, 1, 'c0cb32'),
        ]), 'blueprint');
        assert.equal(r.rideCount, 1);
        assert.equal(r.rides.length, 1);
    });
}
