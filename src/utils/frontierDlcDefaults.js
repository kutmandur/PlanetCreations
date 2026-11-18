// Reviewed 2026-11-18. See docs/frontier-dlc-catalog.md for evidence.
export const DLC_SEED_DATA = Object.freeze({
    'planet-coaster': [
        'Adventure Pack', 'Classic Rides Collection', 'Magnificent Rides Collection',
        'World\'s Fair Pack', 'Vintage Pack', 'Studios Pack', 'Spooky Pack',
        'Ghostbusters™', 'Knight Rider™ K.I.T.T. Construction Kit',
        'Back to the Future™ Time Machine Construction Kit',
        'The Munsters® Munster Koach Construction Kit',
    ].map(name => ({ name, bit: null, identifiers: [] })),
    'planet-coaster-2': [
        ['Bonus Ride Collection', 1, ['PDLC_1']],
        ['Vintage Funfair Ride Pack', 2, ['PDLC_2']],
        ['Thrill-Seekers Ride Pack', 3, ['ContentPDLC1', 'Filter_PDLC_ThrillSeekersRidePack']],
        ['Sorcery Pack', 4, ['ContentPDLC2', 'Filter_PDLC_Sorcery']],
        ['Toybox Pack', 5, ['ContentPDLC3', 'Filter_PDLC_Toybox']],
        ['Parades Pack', 6, ['ContentPDLC4', 'Filter_PDLC_ParadesArcades']],
        ['Silver Screen Pack', 7, ['ContentPDLC5']],
        ['Spooktacular Pack', null, ['ContentPDLC6']],
    ].map(([name, bit, identifiers]) => ({ name, bit, identifiers })),
    // Zoo 2 save mappings await a DLC-bearing reference save.
    'planet-zoo-2': [
        'Deluxe Upgrade Pack', 'Bonus Content Pack',
    ].map(name => ({ name, bit: null, identifiers: [] })),
    'planet-zoo': [
        ['Deluxe Upgrade Pack', 0, 'Deluxe'],
        ['Arctic Pack', 1, 'Content1'],
        ['South America Pack', 2, 'Content2'],
        ['Australia Pack', 3, 'Content3'],
        ['Aquatic Pack', 4, 'Content4'],
        ['Southeast Asia Animal Pack', 5, 'Content5'],
        ['Africa Pack', 6, 'Content6'],
        ['North America Animal Pack', 7, 'Content7'],
        ['Europe Pack', 8, 'Content8'],
        ['Wetlands Animal Pack', 9, 'Content9'],
        ['Conservation Pack', 10, 'Content10'],
        ['Twilight Pack', 11, 'Content11'],
        ['Grasslands Animal Pack', 12, 'Content12'],
        ['Tropical Pack', 13, 'Content13'],
        ['Arid Animal Pack', 14, 'Content14'],
        ['Oceania Pack', 15, 'Content15'],
        ['Eurasia Animal Pack', 16, 'Content16'],
        ['Barnyard Animal Pack', 17, 'Content17'],
        ['Zookeepers Animal Pack', 18, 'Content18'],
        ['Americas Animal Pack', 19, 'Content19'],
        ['Asia Animal Pack', 20, 'Content20'],
    ].map(([name, bit, identifier]) => ({ name, bit, identifiers: [identifier] })),
});

export function mergeFrontierDlcNames(gameId, names = []) {
    return [...new Set([...(Array.isArray(names) ? names : []),
        ...(DLC_SEED_DATA[gameId] || []).map(entry => entry.name)])];
}
