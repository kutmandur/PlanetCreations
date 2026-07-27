const DEFAULT_DEV_SERVER_URL = 'http://localhost:3000';
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function resolveDevServerUrl(configuredUrl = '') {
    const candidate = String(configuredUrl || '').trim() || DEFAULT_DEV_SERVER_URL;
    try {
        const parsed = new URL(candidate);
        if (
            parsed.protocol !== 'http:' ||
            !LOOPBACK_HOSTS.has(parsed.hostname) ||
            parsed.username ||
            parsed.password
        ) {
            return DEFAULT_DEV_SERVER_URL;
        }
        return parsed.origin;
    } catch (error) {
        return DEFAULT_DEV_SERVER_URL;
    }
}

module.exports = {
    DEFAULT_DEV_SERVER_URL,
    resolveDevServerUrl,
};
