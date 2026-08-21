import { getRideCategory, groupParkRides, RIDE_CATEGORY_ORDER } from './verifiedParkStats';

export const PARK_RIDE_PRESENTATION_VERSION = 1;
export const PARK_AREA_LIMIT = 24;
export const PARK_CUSTOM_RIDE_LIMIT = 100;

export const RIDE_CATEGORY_OPTIONS = [
    { key: 'coaster', label: 'Coasters', singular: 'Coaster' },
    { key: 'water-ride', label: 'Water Rides', singular: 'Water Ride' },
    { key: 'water-slide', label: 'Water Slides', singular: 'Water Slide' },
    { key: 'dark-ride', label: 'Dark Rides', singular: 'Dark Ride' },
    { key: 'transport-ride', label: 'Transport Rides', singular: 'Transport Ride' },
    { key: 'flat-ride', label: 'Flat Rides', singular: 'Flat Ride' },
    { key: 'tracked-ride', label: 'Other Tracked Rides', singular: 'Tracked Ride' },
    { key: 'restaurant', label: 'Restaurants', singular: 'Restaurant' },
    { key: 'shop', label: 'Shops', singular: 'Shop' },
    { key: 'show', label: 'Shows', singular: 'Show' },
];

export const AREA_COLOR_PRESETS = [
    '#2563EB', '#7C3AED', '#DB2777', '#DC2626', '#EA580C',
    '#CA8A04', '#16A34A', '#059669', '#0891B2', '#4F46E5',
];

const categoryOptionsByKey = new Map(RIDE_CATEGORY_OPTIONS.map(option => [option.key, option]));
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
const SAFE_HEX_COLOR = /^#[0-9A-F]{6}$/i;
const EFN_METRICS = ['excitement', 'fear', 'nausea'];

const cleanText = (value, maximum) => typeof value === 'string' ? value.trim().slice(0, maximum) : '';
const cleanId = value => typeof value === 'string' && SAFE_ID.test(value) ? value : '';

export function isParkCreationCategory(category) {
    if (typeof category !== 'string') return false;
    return ['park', 'parks'].includes(category.trim().toLowerCase());
}

export function normalizeAreaColor(value, fallback = AREA_COLOR_PRESETS[0]) {
    return typeof value === 'string' && SAFE_HEX_COLOR.test(value) ? value.toUpperCase() : fallback;
}

export function makePresentationId(prefix) {
    const randomPart = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 16) ||
        `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
    return `${prefix}-${randomPart}`;
}

export function sanitizeParkRidePresentation(value) {
    const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    const areaIds = new Set();
    const areas = [];
    for (const rawArea of Array.isArray(source.areas) ? source.areas : []) {
        if (areas.length >= PARK_AREA_LIMIT) break;
        const id = cleanId(rawArea?.id);
        const name = cleanText(rawArea?.name, 60);
        if (!id || !name || areaIds.has(id)) continue;
        areaIds.add(id);
        areas.push({ id, name, color: normalizeAreaColor(rawArea?.color) });
    }

    const customRideIds = new Set();
    const customRides = [];
    for (const rawRide of Array.isArray(source.customRides) ? source.customRides : []) {
        if (customRides.length >= PARK_CUSTOM_RIDE_LIMIT) break;
        const id = cleanId(rawRide?.id);
        const name = cleanText(rawRide?.name, 100);
        const rideCategoryKey = categoryOptionsByKey.has(rawRide?.rideCategoryKey) ?
            rawRide.rideCategoryKey : '';
        if (!id || !name || !rideCategoryKey || customRideIds.has(id)) continue;
        customRideIds.add(id);
        customRides.push({ id, name, rideCategoryKey });
    }

    const hiddenRideKeys = [...new Set((Array.isArray(source.hiddenRideKeys) ? source.hiddenRideKeys : [])
        .map(cleanId).filter(Boolean))].slice(0, 500);
    const rideAreaAssignments = {};
    if (source.rideAreaAssignments && typeof source.rideAreaAssignments === 'object' &&
        !Array.isArray(source.rideAreaAssignments)) {
        for (const [rawRideKey, rawAreaId] of Object.entries(source.rideAreaAssignments)) {
            if (Object.keys(rideAreaAssignments).length >= 500) break;
            const rideKey = cleanId(rawRideKey);
            const areaId = cleanId(rawAreaId);
            if (rideKey && areaIds.has(areaId)) rideAreaAssignments[rideKey] = areaId;
        }
    }

    const rideEfnOverrides = {};
    if (source.rideEfnOverrides && typeof source.rideEfnOverrides === 'object' &&
        !Array.isArray(source.rideEfnOverrides)) {
        for (const [rawRideKey, rawScores] of Object.entries(source.rideEfnOverrides)) {
            if (Object.keys(rideEfnOverrides).length >= 500) break;
            const rideKey = cleanId(rawRideKey);
            if (!rideKey || !rawScores || typeof rawScores !== 'object' || Array.isArray(rawScores)) continue;
            const scores = {};
            for (const metric of EFN_METRICS) {
                const score = rawScores[metric];
                if (Number.isFinite(score) && score >= 0 && score <= 100) scores[metric] = score;
            }
            if (Object.keys(scores).length > 0) rideEfnOverrides[rideKey] = scores;
        }
    }

    const rideDisplayNames = {};
    if (source.rideDisplayNames && typeof source.rideDisplayNames === 'object' &&
        !Array.isArray(source.rideDisplayNames)) {
        for (const [rawRideKey, rawDisplayName] of Object.entries(source.rideDisplayNames)) {
            if (Object.keys(rideDisplayNames).length >= 500) break;
            const rideKey = cleanId(rawRideKey);
            const displayName = cleanText(rawDisplayName, 100);
            if (rideKey && displayName) rideDisplayNames[rideKey] = displayName;
        }
    }

    return {
        version: PARK_RIDE_PRESENTATION_VERSION,
        areas,
        customRides,
        hiddenRideKeys,
        rideAreaAssignments,
        rideEfnOverrides,
        rideDisplayNames,
    };
}

function hashRideIdentity(value) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
}

function savedRideIdentity(ride) {
    return [
        ride?.name || '',
        ride?.typeId || '',
        ride?.category || '',
        ride?.kind || '',
        ride?.rideCategoryKey || '',
        ride?.rideCategory || '',
        ride?.isCountPlaceholder ? 'placeholder' : 'stored',
    ].join('\u001f');
}

export function getPresentedParkRideEntries(park, presentation, options = {}) {
    const normalized = sanitizeParkRidePresentation(presentation);
    const hiddenKeys = new Set(normalized.hiddenRideKeys);
    const identityOccurrences = new Map();
    const savedEntries = groupParkRides(park).flatMap(group => group.rides.map(({ ride, index }) => {
        const identity = savedRideIdentity(ride);
        const occurrence = identityOccurrences.get(identity) || 0;
        identityOccurrences.set(identity, occurrence + 1);
        const key = `save-${hashRideIdentity(identity)}-${occurrence}`;
        const originalDisplayName = ride?.name || ride?.category || `Ride ${index + 1}`;
        return {
            key,
            ride,
            index,
            source: 'save',
            hidden: hiddenKeys.has(key),
            areaId: normalized.rideAreaAssignments[key] || null,
            category: getRideCategory(ride),
            userEfn: normalized.rideEfnOverrides[key] || null,
            originalDisplayName,
            displayName: normalized.rideDisplayNames[key] || originalDisplayName,
        };
    }));

    const customEntries = normalized.customRides.map((customRide, index) => {
        const option = categoryOptionsByKey.get(customRide.rideCategoryKey);
        const ride = {
            kind: customRide.rideCategoryKey === 'flat-ride' ? 'flat' :
                ['restaurant', 'shop', 'show'].includes(customRide.rideCategoryKey) ? 'custom' : 'tracked',
            name: customRide.name,
            category: 'Custom attraction',
            rideCategoryKey: customRide.rideCategoryKey,
            rideCategory: option.singular,
            isCustom: true,
        };
        return {
            key: customRide.id,
            ride,
            index: savedEntries.length + index,
            source: 'custom',
            hidden: hiddenKeys.has(customRide.id),
            areaId: normalized.rideAreaAssignments[customRide.id] || null,
            category: { key: option.key, label: option.label },
            userEfn: normalized.rideEfnOverrides[customRide.id] || null,
            originalDisplayName: customRide.name,
            displayName: normalized.rideDisplayNames[customRide.id] || customRide.name,
        };
    });

    const entries = [...savedEntries, ...customEntries];
    return options.includeHidden ? entries : entries.filter(entry => !entry.hidden);
}

export function groupPresentedParkRides(park, presentation) {
    const groups = new Map();
    for (const entry of getPresentedParkRideEntries(park, presentation)) {
        const group = groups.get(entry.category.key) || {
            key: entry.category.key,
            label: entry.category.label,
            rides: [],
        };
        group.rides.push(entry);
        groups.set(group.key, group);
    }
    return [...groups.values()].sort((left, right) => {
        const leftIndex = RIDE_CATEGORY_ORDER.indexOf(left.key);
        const rightIndex = RIDE_CATEGORY_ORDER.indexOf(right.key);
        return (leftIndex < 0 ? 99 : leftIndex) - (rightIndex < 0 ? 99 : rightIndex);
    });
}

export function groupPresentedParkRidesByArea(park, presentation) {
    const normalized = sanitizeParkRidePresentation(presentation);
    const entries = getPresentedParkRideEntries(park, normalized);
    const groups = normalized.areas.map(area => ({ ...area, rides: [] }));
    const groupsById = new Map(groups.map(group => [group.id, group]));
    const unassigned = {
        id: 'unassigned',
        name: 'Unassigned',
        color: '#6B7280',
        isUnassigned: true,
        rides: [],
    };
    for (const entry of entries) {
        const group = groupsById.get(entry.areaId) || unassigned;
        group.rides.push(entry);
    }
    return unassigned.rides.length > 0 ? [...groups, unassigned] : groups;
}

export function colorWithAlpha(color, alphaHex = '18') {
    return `${normalizeAreaColor(color)}${alphaHex}`;
}
