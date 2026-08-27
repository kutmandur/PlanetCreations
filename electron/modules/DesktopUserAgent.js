'use strict';

function buildDesktopWebUserAgent(userAgent = '') {
    if (typeof userAgent !== 'string') return '';

    // Electron embeds its runtime product in Chromium's otherwise normal user
    // agent. reCAPTCHA Enterprise treats that product as automated/high-risk
    // traffic, even though the hosted UI is running in our trusted desktop app.
    // Keep the real OS and Chrome versions while presenting the web-compatible
    // Chromium identity expected by Firebase App Check.
    return userAgent
        .replace(/\s+Electron\/[^\s]+/gi, '')
        .replace(/\s{2,}/g, ' ')
        .trim();
}

module.exports = { buildDesktopWebUserAgent };
