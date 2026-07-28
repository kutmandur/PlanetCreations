const SAFE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const COLLABORATION_FILE_ID = "save";

function requireSafeId(value, label) {
    if (typeof value !== "string" || !SAFE_ID_PATTERN.test(value)) {
        throw new Error(`${label} is invalid.`);
    }
    return value;
}

function buildCollaborationVersionStorageKey(collaborationId, versionId) {
    const safeCollaborationId = requireSafeId(collaborationId, "Collaboration ID");
    const safeVersionId = requireSafeId(versionId, "Version ID");
    return `collaboration-files/${safeCollaborationId}/${COLLABORATION_FILE_ID}/${safeVersionId}.PlanetCreations`;
}

function buildCollaborationStoragePrefix(collaborationId) {
    const safeCollaborationId = requireSafeId(collaborationId, "Collaboration ID");
    return `collaboration-files/${safeCollaborationId}/${COLLABORATION_FILE_ID}/`;
}

function isCollaborationVersionStorageKey(storageKey, collaborationId, versionId) {
    if (typeof storageKey !== "string") return false;
    try {
        return storageKey === buildCollaborationVersionStorageKey(collaborationId, versionId);
    } catch {
        return false;
    }
}

function isCollaborationStorageObjectKey(storageKey, collaborationId) {
    if (typeof storageKey !== "string") return false;
    try {
        const prefix = buildCollaborationStoragePrefix(collaborationId);
        if (!storageKey.startsWith(prefix) ||
            !storageKey.endsWith(".PlanetCreations")) {
            return false;
        }
        const versionId = storageKey.slice(
            prefix.length,
            -".PlanetCreations".length,
        );
        return isCollaborationVersionStorageKey(
            storageKey,
            collaborationId,
            versionId,
        );
    } catch {
        return false;
    }
}

function canDownloadCollaborationVersion({memberExists = false} = {}) {
    return memberExists === true;
}

function getCollaborationRetentionLimit(memberCount) {
    return Number(memberCount) > 10 ? 2 : 3;
}

function getVersionNumber(version) {
    const value = version && (version.versionNumber ?? version.number);
    return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function getNextVersionNumber(fileData) {
    const latestVersionNumber = getVersionNumber({
        versionNumber: fileData && fileData.latestVersionNumber,
    });
    return Math.max(
        latestVersionNumber,
        getVersionNumber(fileData && fileData.currentVersion),
    ) + 1;
}

function shouldPromotePendingVersion(
    pendingBuildEndedAtMs,
    currentBuildEndedAtMs,
) {
    if (!Number.isFinite(currentBuildEndedAtMs)) return true;
    if (!Number.isFinite(pendingBuildEndedAtMs)) return false;
    return pendingBuildEndedAtMs >= currentBuildEndedAtMs;
}

function selectPrunableVersions(versions, keep, currentVersionId) {
    const retention = Number.isSafeInteger(keep) && keep > 0 ? keep : 1;
    const sorted = [...versions].sort((left, right) =>
        getVersionNumber(right) - getVersionNumber(left));
    const retainedIds = new Set(sorted.slice(0, retention).map((version) => version.id));
    return sorted.filter((version) =>
        version.id !== currentVersionId && !retainedIds.has(version.id));
}

module.exports = {
    COLLABORATION_FILE_ID,
    buildCollaborationStoragePrefix,
    buildCollaborationVersionStorageKey,
    canDownloadCollaborationVersion,
    getCollaborationRetentionLimit,
    getNextVersionNumber,
    getVersionNumber,
    isCollaborationStorageObjectKey,
    isCollaborationVersionStorageKey,
    requireSafeId,
    selectPrunableVersions,
    shouldPromotePendingVersion,
};
