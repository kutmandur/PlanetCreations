'use strict';

const STORE_CHANNEL = 'store';
const GITHUB_CHANNEL = 'github';

function getDistributionChannel({ windowsStore = process.windowsStore, env = process.env } = {}) {
    if (windowsStore === true || env?.PLANETCREATIONS_DISTRIBUTION_CHANNEL === STORE_CHANNEL) {
        return STORE_CHANNEL;
    }
    return GITHUB_CHANNEL;
}

function getDistributionInfo(options) {
    const channel = getDistributionChannel(options);
    return {
        channel,
        isStore: channel === STORE_CHANNEL,
        updatesManagedBy: channel === STORE_CHANNEL ? 'microsoft-store' : 'electron-updater',
    };
}

module.exports = {
    GITHUB_CHANNEL,
    STORE_CHANNEL,
    getDistributionChannel,
    getDistributionInfo,
};
