const PUBLIC_COLLABORATION_VISIBILITY = "public";
const UNLISTED_COLLABORATION_VISIBILITY = "unlisted";

function normalizeCollaborationVisibility(value) {
    return value === PUBLIC_COLLABORATION_VISIBILITY ?
        PUBLIC_COLLABORATION_VISIBILITY :
        UNLISTED_COLLABORATION_VISIBILITY;
}

function isSafeHttpUrl(value) {
    if (typeof value !== "string" || !value.trim()) return false;
    try {
        const parsed = new URL(value.trim());
        return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch (error) {
        return false;
    }
}

function timestampToMillis(value) {
    if (value && typeof value.toMillis === "function") return value.toMillis();
    if (value && Number.isFinite(value.seconds)) return value.seconds * 1000;
    return Number.isFinite(value) ? value : null;
}

function sanitizeCurrentVersion(version) {
    if (!version || typeof version !== "object") return null;
    return {
        versionId: version.versionId || null,
        number: Number(version.number) || null,
        uploadedByUsername: version.uploadedByUsername || "Unknown",
        uploadedAt: timestampToMillis(version.uploadedAt),
        sizeBytes: Number(version.sizeBytes) || 0,
        originalFileName: version.originalFileName || "Shared save",
        note: version.note || "",
        changelogEntryId: version.changelogEntryId || null,
        buildEndedAt: timestampToMillis(version.buildEndedAt),
    };
}

function sanitizeBuildLock(lock) {
    if (!lock || typeof lock !== "object" || !lock.activeBuilderId) return null;
    return {
        activeBuilderId: "public-active-builder",
        username: lock.username || "Someone",
        startedAt: timestampToMillis(lock.startedAt),
        expiresAt: timestampToMillis(lock.expiresAt),
    };
}

function buildPublicCollaborationSummary(id, collaboration = {}) {
    return {
        id,
        title: collaboration.title || "",
        description: collaboration.description || "",
        game: collaboration.game || null,
        bannerImageUrl: isSafeHttpUrl(collaboration.bannerImageUrl) ?
            collaboration.bannerImageUrl.trim() :
            null,
        galleryImageUrls: Array.isArray(collaboration.galleryImageUrls) ?
            collaboration.galleryImageUrls.filter(isSafeHttpUrl).slice(0, 10) :
            [],
        status: collaboration.status || "active",
        visibility: PUBLIC_COLLABORATION_VISIBILITY,
        ownerId: collaboration.ownerId || null,
        memberCount: Array.isArray(collaboration.memberIds) ?
            collaboration.memberIds.length :
            0,
        currentVersion: sanitizeCurrentVersion(collaboration.currentVersion),
        buildLock: sanitizeBuildLock(collaboration.buildLock),
        createdAt: timestampToMillis(collaboration.createdAt),
        updatedAt: timestampToMillis(collaboration.updatedAt),
        publicReadOnly: true,
        userRole: "visitor",
    };
}

function sanitizePublicMember(id, member = {}) {
    return {
        id,
        username: member.username || "Unknown member",
        role: ["owner", "editor", "viewer"].includes(member.role) ?
            member.role :
            "viewer",
        joinedAt: timestampToMillis(member.joinedAt),
    };
}

function sanitizePublicVersion(id, version = {}) {
    return {
        id,
        versionNumber: Number(version.versionNumber || version.number) || 1,
        uploadedByUsername: version.uploadedByUsername || "Unknown",
        uploadedAt: timestampToMillis(version.uploadedAt),
        sizeBytes: Number(version.sizeBytes) || 0,
        originalFileName: version.originalFileName || "Shared save",
        note: version.note || "",
        buildEndedAt: timestampToMillis(version.buildEndedAt),
    };
}

function sanitizePublicUpload(id, upload = {}) {
    return {
        id,
        kind: upload.kind || "changelog",
        fileName: upload.fileName || null,
        username: upload.username || "Unknown contributor",
        changelog: upload.changelog || "",
        imageUrls: Array.isArray(upload.imageUrls) ?
            upload.imageUrls.filter(isSafeHttpUrl).slice(0, 10) :
            [],
        completedTodos: Array.isArray(upload.completedTodos) ?
            upload.completedTodos.slice(0, 50).map((todo) => ({
                id: (todo && todo.id) || "",
                text: (todo && todo.text) || "",
            })) :
            [],
        versionId: upload.versionId || null,
        versionNumber: Number(upload.versionNumber) || null,
        sizeBytes: Number(upload.sizeBytes) || 0,
        workDurationMinutes: Number(upload.workDurationMinutes) || null,
        hasSave: upload.hasSave === true,
        status: upload.status || null,
        createdAt: timestampToMillis(upload.createdAt),
        updatedAt: timestampToMillis(upload.updatedAt),
    };
}

function sanitizePublicTodo(id, todo = {}) {
    return {
        id,
        text: todo.text || "",
        completed: todo.completed === true,
        createdAt: timestampToMillis(todo.createdAt),
    };
}

module.exports = {
    PUBLIC_COLLABORATION_VISIBILITY,
    UNLISTED_COLLABORATION_VISIBILITY,
    normalizeCollaborationVisibility,
    buildPublicCollaborationSummary,
    sanitizePublicMember,
    sanitizePublicVersion,
    sanitizePublicUpload,
    sanitizePublicTodo,
};
