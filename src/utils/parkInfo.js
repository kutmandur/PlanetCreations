// Manual, creator-authored statistics. These never imply savefile verification.
export const PARK_INFO_FIELDS = [
    {
        "key": "placementCost",
        "label": "Build cost"
    },
    {
        "key": "runningCost",
        "label": "Running cost"
    },
    {
        "key": "placedPartCount",
        "label": "Construction parts"
    },
    {
        "key": "sceneryPieceCount",
        "label": "Scenery pieces"
    },
    {
        "key": "buildingCount",
        "label": "Buildings / scenery groups"
    },
    {
        "key": "railElementCount",
        "label": "Rail elements"
    },
    {
        "key": "trackedRideElementCount",
        "label": "Tracked-ride elements"
    },
    {
        "key": "binCount",
        "label": "Bins"
    },
    {
        "key": "poolCount",
        "label": "Pools"
    },
    {
        "key": "guestCount",
        "label": "Guests"
    },
    {
        "key": "guestCap",
        "label": "Guest capacity"
    },
    {
        "key": "animalCount",
        "label": "Animals"
    },
    {
        "key": "parkRating",
        "label": "Park rating"
    },
    {
        "key": "guestHappiness",
        "label": "Guest happiness"
    },
    {
        "key": "cash",
        "label": "Balance"
    },
    {
        "key": "complexity",
        "label": "Complexity"
    },
    {
        "key": "scenarioStarsEarned",
        "label": "Scenario stars earned"
    },
    {
        "key": "scenarioStarsTotal",
        "label": "Scenario stars total"
    },
    {
        "key": "sceneryCount",
        "label": "Loose scenery"
    },
    {
        "key": "serializedGroupCount",
        "label": "Serialized groups"
    },
    {
        "key": "generatedPower",
        "label": "Generated power"
    },
    {
        "key": "requiredPower",
        "label": "Required power"
    },
    {
        "key": "generatedWater",
        "label": "Generated water"
    },
    {
        "key": "requiredWater",
        "label": "Required water"
    },
    {
        "key": "excitement",
        "label": "Excitement"
    },
    {
        "key": "fear",
        "label": "Fear"
    },
    {
        "key": "nausea",
        "label": "Nausea"
    }
];
export const RIDE_INFO_FIELDS = [
    {
        "key": "durationSeconds",
        "label": "Test duration (s)"
    },
    {
        "key": "traversalLengthMeters",
        "label": "Traversal length (m)"
    },
    {
        "key": "maxSpeedKph",
        "label": "Max speed (km/h)"
    },
    {
        "key": "sampleCount",
        "label": "Samples"
    },
    {
        "key": "lateral_min",
        "label": "Lateral G min"
    },
    {
        "key": "lateral_max",
        "label": "Lateral G max"
    },
    {
        "key": "vertical_min",
        "label": "Vertical G min"
    },
    {
        "key": "vertical_max",
        "label": "Vertical G max"
    },
    {
        "key": "longitudinal_min",
        "label": "Longitudinal G min"
    },
    {
        "key": "longitudinal_max",
        "label": "Longitudinal G max"
    }
];
export function sanitizeNumericInfo(value, fields) {
    const result = {};
    for (const {key} of fields) {
        const number = value?.[key];
        if (number === null || (Number.isFinite(number) && Math.abs(number) <= Number.MAX_SAFE_INTEGER)) result[key] = number;
    }
    return result;
}
export function getParkInfo(metadata, presentation) {
    const source = {...metadata?.park, ...metadata?.blueprint, ...metadata?.blueprint?.utilities, ...metadata?.blueprint?.ratings};
    return {...sanitizeNumericInfo(source, PARK_INFO_FIELDS), ...sanitizeNumericInfo(presentation?.parkInfo, PARK_INFO_FIELDS)};
}

export const PARK_TEXT_FIELDS = [
    {key: 'gameMode', label: 'Mode'}, {key: 'biome', label: 'Biome'},
    {key: 'difficulty', label: 'Difficulty'}, {key: 'gameVersion', label: 'Game version'},
    {key: 'saveFormatVersion', label: 'Save format'}, {key: 'rideId', label: 'Ride ID'},
];
export function getParkText(metadata, presentation) {
    const source = {...metadata, ...metadata?.park, ...metadata?.blueprint, ...presentation?.parkText};
    return Object.fromEntries(PARK_TEXT_FIELDS.map(({key}) => [key, source[key] == null ? '' : String(source[key])]));
}
export function getRideInfo(ride, manual) {
    const source = {...ride?.testStats};
    for (const axis of ['lateral', 'vertical', 'longitudinal']) {
        for (const bound of ['min', 'max']) source[`${axis}_${bound}`] = ride?.testStats?.gForces?.[axis]?.[bound];
    }
    return {...sanitizeNumericInfo(source, RIDE_INFO_FIELDS), ...manual};
}
