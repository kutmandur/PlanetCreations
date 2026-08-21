"use strict";

const CATEGORY = Object.freeze({
    COASTER: Object.freeze({key: "coaster", label: "Coaster"}),
    DARK_RIDE: Object.freeze({key: "dark-ride", label: "Dark Ride"}),
    FLAT_RIDE: Object.freeze({key: "flat-ride", label: "Flat Ride"}),
    TRACKED_RIDE: Object.freeze({key: "tracked-ride", label: "Tracked Ride"}),
    TRANSPORT_RIDE: Object.freeze({key: "transport-ride", label: "Transport Ride"}),
    WATER_RIDE: Object.freeze({key: "water-ride", label: "Water Ride"}),
    WATER_SLIDE: Object.freeze({key: "water-slide", label: "Water Slide"}),
});

const LEGACY_COASTER_IDS = new Set(["degen", "monster", "rage", "torque"]);

function hasTag(tags, pattern) {
    return Array.isArray(tags) && tags.some((tag) =>
        typeof tag === "string" && pattern.test(tag));
}

function resolveFrontierRideCategory(kind, typeId, tags = []) {
    if (kind === "flat") return CATEGORY.FLAT_RIDE;
    const id = String(typeId || "").toLowerCase();
    if (/^(?:tr|trr|transport)_/.test(id) ||
        /(steamtrain|railroad|monorail|cablecar|single-?decker|transport|steamboat|gondola)/.test(id)) {
        return CATEGORY.TRANSPORT_RIDE;
    }
    if (/^cc_/.test(id) || LEGACY_COASTER_IDS.has(id)) return CATEGORY.COASTER;
    if (/(bodyflume|raftflume|innertube|mat(?:slide|flume)|waterslide)/.test(id)) {
        return CATEGORY.WATER_SLIDE;
    }
    if (/^wrc_/.test(id) || /(logflume|riverrapids)/.test(id)) {
        return CATEGORY.WATER_RIDE;
    }
    if (/^ptr_/.test(id) || /(darkride|ghosttrain|poweredautomated)/.test(id)) {
        return CATEGORY.DARK_RIDE;
    }
    if (hasTag(tags, /^Menu_TrackedRide_Transport$/i)) return CATEGORY.TRANSPORT_RIDE;
    if (hasTag(tags, /^(?:Flumes|Menu_Flume)/i)) return CATEGORY.WATER_SLIDE;
    if (hasTag(tags, /^Menu_TrackedRide_Water$/i)) return CATEGORY.WATER_RIDE;
    if (hasTag(tags, /^(?:Coasters|Menu_Coaster_)/i)) return CATEGORY.COASTER;
    if (hasTag(tags, /^Menu_TrackedRide_Powered$/i)) return CATEGORY.DARK_RIDE;
    return CATEGORY.TRACKED_RIDE;
}

module.exports = {CATEGORY, resolveFrontierRideCategory};
