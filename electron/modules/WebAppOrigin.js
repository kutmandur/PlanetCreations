const PRODUCTION_WEB_ORIGIN = 'https://www.planetcreations.net';
const LEGACY_WEB_ORIGIN = 'https://planetcreations.net';

function isProductionWebOrigin(origin) {
    return origin === PRODUCTION_WEB_ORIGIN || origin === LEGACY_WEB_ORIGIN;
}

module.exports = {
    LEGACY_WEB_ORIGIN,
    PRODUCTION_WEB_ORIGIN,
    isProductionWebOrigin,
};
