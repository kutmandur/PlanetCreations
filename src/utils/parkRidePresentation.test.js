import {
    getPresentedParkRideEntries,
    groupPresentedParkRides,
    groupPresentedParkRidesByArea,
    RIDE_CATEGORY_OPTIONS,
    sanitizeParkRidePresentation,
} from './parkRidePresentation';

const park = {
    trackedRideCount: 2,
    flatRideCount: 1,
    rides: [
        { kind: 'tracked', name: 'Launch One', typeId: 'Launch', rideCategoryKey: 'coaster', rideCategory: 'Coaster' },
        { kind: 'tracked', name: 'River One', typeId: 'River', rideCategoryKey: 'water-ride', rideCategory: 'Water Ride' },
        { kind: 'flat', category: 'Wheel', rideCategoryKey: 'flat-ride', rideCategory: 'Flat Ride' },
    ],
};

test('keeps save ride keys stable and applies user visibility, custom rides and areas', () => {
    const initialEntries = getPresentedParkRideEntries(park, {}, { includeHidden: true });
    const launchKey = initialEntries.find(entry => entry.displayName === 'Launch One').key;
    const riverKey = initialEntries.find(entry => entry.displayName === 'River One').key;
    const presentation = {
        areas: [{ id: 'area-harbor', name: 'Harbor', color: '#0891b2' }],
        customRides: [{ id: 'custom-show', name: 'Laser Show', rideCategoryKey: 'dark-ride' }],
        hiddenRideKeys: [riverKey],
        rideAreaAssignments: { [launchKey]: 'area-harbor', 'custom-show': 'area-harbor' },
        rideEfnOverrides: { [launchKey]: { excitement: 7.2, fear: 3.4, nausea: 1.1 } },
        rideDisplayNames: { [launchKey]: 'Harbor Launch' },
    };

    const visibleEntries = getPresentedParkRideEntries(park, presentation);
    expect(visibleEntries.map(entry => entry.displayName)).toEqual(['Harbor Launch', 'Wheel', 'Laser Show']);
    expect(getPresentedParkRideEntries(park, presentation, { includeHidden: true })
        .find(entry => entry.originalDisplayName === 'Launch One').key).toBe(launchKey);
    expect(visibleEntries.find(entry => entry.originalDisplayName === 'Launch One').userEfn)
        .toEqual({ excitement: 7.2, fear: 3.4, nausea: 1.1 });
    expect(groupPresentedParkRides(park, presentation).map(group => [group.key, group.rides.length]))
        .toEqual([['coaster', 1], ['dark-ride', 1], ['flat-ride', 1]]);
    expect(groupPresentedParkRidesByArea(park, presentation).map(group => [group.name, group.rides.length]))
        .toEqual([['Harbor', 2], ['Unassigned', 1]]);
});

test('sanitizes invalid and oversized presentation values', () => {
    expect(sanitizeParkRidePresentation({
        areas: [{ id: 'bad id', name: 'Ignored', color: 'red' }, { id: 'valid', name: ' Main ', color: '#abcdef' }],
        customRides: [{ id: 'custom-1', name: ' Mine Train ', rideCategoryKey: 'coaster' }, { id: 'custom-2', name: '', rideCategoryKey: 'coaster' }],
        hiddenRideKeys: ['bad key', 'save-valid-0'],
        rideAreaAssignments: { 'custom-1': 'valid', 'save-valid-0': 'missing' },
        rideEfnOverrides: {
            'custom-1': { excitement: 5.5, fear: -1, nausea: 101 },
            'bad key': { excitement: 4 },
        },
        rideDisplayNames: { 'custom-1': ' Mine Train Express ', 'bad key': 'Ignored' },
    })).toEqual({
        version: 1,
        areas: [{ id: 'valid', name: 'Main', color: '#ABCDEF' }],
        customRides: [{ id: 'custom-1', name: 'Mine Train', rideCategoryKey: 'coaster' }],
        hiddenRideKeys: ['save-valid-0'],
        rideAreaAssignments: { 'custom-1': 'valid' },
        rideEfnOverrides: { 'custom-1': { excitement: 5.5 } },
        rideDisplayNames: { 'custom-1': 'Mine Train Express' },
    });
});

test('offers shows as a presentation-only venue category', () => {
    expect(RIDE_CATEGORY_OPTIONS).toContainEqual({ key: 'show', label: 'Shows', singular: 'Show' });
    expect(sanitizeParkRidePresentation({
        customRides: [{ id: 'custom-show', name: 'Harbor Stage', rideCategoryKey: 'show' }],
    }).customRides).toEqual([{ id: 'custom-show', name: 'Harbor Stage', rideCategoryKey: 'show' }]);
});
