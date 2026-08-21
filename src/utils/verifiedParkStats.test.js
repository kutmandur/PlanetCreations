import {
    getCombinedParkPieceCount,
    getParkRideCount,
    groupParkRides,
} from './verifiedParkStats';

test('groups every park ride by player-facing category and preserves aggregate counts', () => {
    const park = {
        rideCount: 6,
        trackedRideCount: 4,
        flatRideCount: 2,
        rides: [
            { kind: 'tracked', rideCategoryKey: 'coaster', rideCategory: 'Coaster', name: 'Launch One' },
            { kind: 'tracked', rideCategoryKey: 'water-ride', rideCategory: 'Water Ride', name: 'Log One' },
            { kind: 'flat', rideCategoryKey: 'flat-ride', rideCategory: 'Flat Ride', category: 'Big Wheel' },
        ],
    };

    const groups = groupParkRides(park);
    expect(groups.map(group => [group.key, group.rides.length])).toEqual([
        ['coaster', 1],
        ['water-ride', 1],
        ['flat-ride', 2],
        ['tracked-ride', 2],
    ]);
    expect(getParkRideCount(park)).toBe(6);
});
test('combines distinct serialized piece managers without double-counting transform entities', () => {
    expect(getCombinedParkPieceCount({
        placedPartCount: 199034,
        sceneryPieceCount: 195181,
        railElementCount: 2484,
        trackedRideElementCount: 595,
        binCount: 1444,
    })).toBe(203557);
});
