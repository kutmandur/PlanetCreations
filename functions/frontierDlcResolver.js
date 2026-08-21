"use strict";

// Frontier writes these content identifiers as PDLC_1, PDLC_2, ... in
// blueprint tags and stores the used set as nRequiredDLC. Keep this server
// mapping aligned with the desktop resolver so verified documents contain
// display names while retaining every raw/unknown bit.
const PLANET_COASTER_2_DLC_BITS = Object.freeze([
    {bit: 1, name: "Bonus Ride Collection"},
    {bit: 2, name: "Vintage Funfair Ride Pack"},
    {bit: 3, name: "Thrill-Seekers Ride Pack"},
    {bit: 4, name: "Sorcery Pack"},
    {bit: 5, name: "Toybox Pack"},
    {bit: 6, name: "Parades Pack"},
    {bit: 7, name: "Silver Screen Pack"},
]);

const DLC_BITS_BY_GAME = new Map([
    ["planet-coaster-2", PLANET_COASTER_2_DLC_BITS],
]);

function resolveFrontierDlcMask(gameId, rawMask) {
    const mask = Number.isSafeInteger(rawMask) && rawMask >= 0 ? rawMask : null;
    if (mask === null) {
        return {
            mappingVersion: 1,
            requiredDlcs: [],
            requiredDlcBits: [],
            unknownDlcBits: [],
        };
    }

    const requiredDlcBits = [];
    for (let bit = 0; bit <= 52 && 2 ** bit <= mask; bit += 1) {
        if (Math.floor(mask / (2 ** bit)) % 2 === 1) {
            requiredDlcBits.push(bit);
        }
    }
    const mapping = new Map((DLC_BITS_BY_GAME.get(gameId) || [])
        .map((entry) => [entry.bit, entry.name]));
    return {
        mappingVersion: 1,
        requiredDlcs: requiredDlcBits
            .map((bit) => mapping.get(bit))
            .filter(Boolean),
        requiredDlcBits,
        unknownDlcBits: requiredDlcBits
            .filter((bit) => !mapping.has(bit)),
    };
}

module.exports = {
    PLANET_COASTER_2_DLC_BITS,
    resolveFrontierDlcMask,
};
