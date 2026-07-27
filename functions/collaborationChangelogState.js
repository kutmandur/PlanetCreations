function calculateWorkDurationMinutes(startedAtMs, endedAtMs) {
    if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs) ||
        endedAtMs < startedAtMs) {
        return null;
    }
    return Math.max(1, Math.round((endedAtMs - startedAtMs) / 60000));
}

function getMissingSaveWarning(latestChangelog, acknowledged) {
    if (!latestChangelog || latestChangelog.hasSave !== false || acknowledged) {
        return null;
    }
    return {
        entryId: latestChangelog.entryId || null,
        userId: latestChangelog.userId || null,
        username: latestChangelog.username || "Unknown contributor",
    };
}

function isChangelogOwner(entry, userId) {
    return Boolean(entry && userId && entry.userId === userId);
}

function canAttachPendingSave(entry, userId) {
    return isChangelogOwner(entry, userId) &&
        entry.kind === "changelog" &&
        entry.status === "pending-save" &&
        entry.hasSave !== true &&
        !entry.versionId;
}

function getCollaborationReleaseRecipientIds(memberIds, builderId) {
    const excludedId = String(builderId || "").trim();
    return [...new Set((Array.isArray(memberIds) ? memberIds : [])
        .map((memberId) => String(memberId || "").trim())
        .filter((memberId) => memberId && memberId !== excludedId))];
}

function buildCollaborationReleaseNotification({
    collaborationId,
    collaborationTitle,
    username,
}) {
    const title = String(collaborationTitle || "").trim() ||
        "Collaboration";
    const builderName = String(username || "").trim() ||
        "The previous builder";
    return {
        title: `${title} is free to build`,
        message: `${builderName} left build mode. The creation is available now.`,
        link: `/collaboration/${collaborationId}`,
    };
}

module.exports = {
    buildCollaborationReleaseNotification,
    calculateWorkDurationMinutes,
    getCollaborationReleaseRecipientIds,
    getMissingSaveWarning,
    isChangelogOwner,
    canAttachPendingSave,
};
