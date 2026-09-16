// Manual panels remain usable when automatic game detection is disabled.
function shouldShowOverlay({ expanded = false, iconEnabled = true, forcedVisible = false, autoEnabled = true, activeGameId = null }) {
    return expanded || (iconEnabled && (forcedVisible || (autoEnabled && Boolean(activeGameId))));
}

module.exports = { shouldShowOverlay };
