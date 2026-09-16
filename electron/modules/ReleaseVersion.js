'use strict';

const semver = require('semver');

function getNewerReleaseVersion(tag, currentVersion) {
    if (typeof tag !== 'string' || typeof currentVersion !== 'string') return null;
    const version = semver.valid(tag);
    const current = semver.valid(currentVersion);
    return version && current && semver.gt(version, current) ? version : null;
}

module.exports = { getNewerReleaseVersion };
