'use strict';

function normalizeAppRoute(route = '/') {
    if (typeof route !== 'string' || !route.startsWith('/') || route.startsWith('//')) {
        return '/';
    }
    return route.slice(0, 500);
}

function buildHostedAppRouteUrl(baseUrl, route = '/') {
    const base = new URL(baseUrl);
    const target = new URL(normalizeAppRoute(route), `${base.origin}/`);
    base.searchParams.forEach((value, key) => {
        if (!target.searchParams.has(key)) target.searchParams.append(key, value);
    });
    return target.toString();
}

function buildBundledAppRouteUrl(baseUrl, route = '/') {
    const target = new URL(baseUrl);
    target.hash = normalizeAppRoute(route);
    return target.toString();
}

function getAppRoutePath(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        const route = parsed.protocol === 'file:'
            ? parsed.hash.slice(1)
            : parsed.pathname;
        return normalizeAppRoute(route || '/').split('?')[0];
    } catch (_error) {
        return '/';
    }
}

module.exports = {
    buildBundledAppRouteUrl,
    buildHostedAppRouteUrl,
    getAppRoutePath,
    normalizeAppRoute,
};
