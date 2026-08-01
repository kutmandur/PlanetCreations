"use strict";

function getCollaborationInvitationGrantId(collaborationId, targetUserId) {
    return `${collaborationId}--${targetUserId}`;
}

function isCollaborationManager(collaboration, userId, siteRole) {
    return collaboration.ownerId === userId ||
        siteRole === "moderator" ||
        siteRole === "admin";
}

function hasActiveCollaborationBuildLock(
    collaboration,
    userId,
    nowMillis = Date.now(),
) {
    const lock = collaboration.buildLock || {};
    if (lock.activeBuilderId !== userId) return false;
    const expiresAtMillis = lock.expiresAt &&
        typeof lock.expiresAt.toMillis === "function" ?
        lock.expiresAt.toMillis() :
        0;
    return expiresAtMillis > nowMillis;
}

module.exports = {
    getCollaborationInvitationGrantId,
    hasActiveCollaborationBuildLock,
    isCollaborationManager,
};
