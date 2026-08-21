export const RIDE_CATEGORY_ORDER = [
    'coaster',
    'water-ride',
    'water-slide',
    'dark-ride',
    'transport-ride',
    'flat-ride',
    'tracked-ride',
    'restaurant',
    'shop',
    'show',
];

const CATEGORY_LABELS = {
    coaster: 'Coasters',
    'water-ride': 'Water Rides',
    'water-slide': 'Water Slides',
    'dark-ride': 'Dark Rides',
    'transport-ride': 'Transport Rides',
    'flat-ride': 'Flat Rides',
    'tracked-ride': 'Other Tracked Rides',
    restaurant: 'Restaurants',
    shop: 'Shops',
    show: 'Shows',
};

export function getRideCategory(ride) {
    if (ride?.rideCategoryKey) {
        return {
            key: ride.rideCategoryKey,
            label: CATEGORY_LABELS[ride.rideCategoryKey] || ride.rideCategory || 'Other Rides',
        };
    }
    return ride?.kind === 'flat'
        ? { key: 'flat-ride', label: CATEGORY_LABELS['flat-ride'] }
        : { key: 'tracked-ride', label: CATEGORY_LABELS['tracked-ride'] };
}

export function groupParkRides(park) {
    const groups = new Map();
    for (const [index, ride] of (park?.rides || []).entries()) {
        const category = getRideCategory(ride);
        const group = groups.get(category.key) || { ...category, rides: [] };
        group.rides.push({ ride, index });
        groups.set(category.key, group);
    }

    const trackedKnown = (park?.rides || []).filter(ride => ride?.kind === 'tracked').length;
    const flatKnown = (park?.rides || []).filter(ride => ride?.kind === 'flat').length;
    const missingTracked = Number.isFinite(park?.trackedRideCount)
        ? Math.max(0, park.trackedRideCount - trackedKnown)
        : 0;
    const missingFlat = Number.isFinite(park?.flatRideCount)
        ? Math.max(0, park.flatRideCount - flatKnown)
        : 0;

    const addUnknownRides = (key, count, kind) => {
        if (count === 0) return;
        const category = getRideCategory({ kind, rideCategoryKey: key });
        const group = groups.get(key) || { ...category, rides: [] };
        for (let offset = 0; offset < count; offset += 1) {
            group.rides.push({ ride: { kind, isCountPlaceholder: true }, index: trackedKnown + flatKnown + offset });
        }
        groups.set(key, group);
    };
    addUnknownRides('tracked-ride', missingTracked, 'tracked');
    addUnknownRides('flat-ride', missingFlat, 'flat');

    return [...groups.values()].sort((left, right) => {
        const leftIndex = RIDE_CATEGORY_ORDER.indexOf(left.key);
        const rightIndex = RIDE_CATEGORY_ORDER.indexOf(right.key);
        return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
    });
}

export function getParkRideCount(park) {
    if (Number.isFinite(park?.rideCount)) return park.rideCount;
    if (Number.isFinite(park?.trackedRideCount) || Number.isFinite(park?.flatRideCount)) {
        return (park?.trackedRideCount || 0) + (park?.flatRideCount || 0);
    }
    return Array.isArray(park?.rides) ? park.rides.length : null;
}

export function getCombinedParkPieceCount(park) {
    if (!Number.isFinite(park?.placedPartCount)) return null;
    // PlacementPartData already covers the scenery/building PartData entities.
    // Rails, tracked-ride elements and bins live in separate managers and must
    // be added. sceneryPieceCount is deliberately excluded to avoid counting
    // the same placed pieces a second time through their transform component.
    return [
        park.placedPartCount,
        park.railElementCount,
        park.trackedRideElementCount,
        park.binCount,
    ].reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}
