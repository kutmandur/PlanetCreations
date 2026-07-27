const INSTALLED_VERSION_KEY_PREFIX =
    'planetcreations.collaborationInstalledVersions';
const INSTALLED_VERSION_CHANGED_EVENT =
    'planetcreations:collaboration-installed-version-changed';

const getStorage = (storage) => {
    if (storage) return storage;
    if (typeof window === 'undefined') return null;
    return window.localStorage;
};

export const getInstalledCollaborationVersionsKey = (userId) => (
    `${INSTALLED_VERSION_KEY_PREFIX}.${String(userId || '').trim()}`
);

const normalizeInstalledVersion = (value) => {
    if (!value || typeof value !== 'object') return null;
    const collaborationId = String(value.collaborationId || '').trim();
    const gameId = String(value.gameId || '').trim();
    const versionId = String(value.versionId || '').trim();
    const versionNumber = Number(value.versionNumber);
    if (!collaborationId || !gameId || !versionId ||
        !Number.isSafeInteger(versionNumber) || versionNumber < 1) {
        return null;
    }
    const normalized = {
        collaborationId,
        gameId,
        versionId,
        versionNumber,
        recordedAtMillis: Number.isFinite(Number(value.recordedAtMillis))
            ? Number(value.recordedAtMillis)
            : 0,
    };
    const targetPath = String(value.targetPath || '').trim();
    if (targetPath && targetPath.length <= 4096) {
        normalized.targetPath = targetPath;
    }
    return normalized;
};

export const readInstalledCollaborationVersions = (userId, storage) => {
    const normalizedUserId = String(userId || '').trim();
    const target = getStorage(storage);
    if (!normalizedUserId || !target) return {};
    try {
        const parsed = JSON.parse(target.getItem(
            getInstalledCollaborationVersionsKey(normalizedUserId),
        ));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }
        return Object.entries(parsed).reduce((result, [collaborationId, value]) => {
            const normalized = normalizeInstalledVersion({
                ...value,
                collaborationId,
            });
            if (normalized) result[collaborationId] = normalized;
            return result;
        }, {});
    } catch (error) {
        return {};
    }
};

export const recordInstalledCollaborationVersion = ({
    userId,
    collaborationId,
    gameId,
    versionId,
    versionNumber,
    targetPath = '',
    recordedAtMillis = Date.now(),
}, storage) => {
    const normalizedUserId = String(userId || '').trim();
    const normalized = normalizeInstalledVersion({
        collaborationId,
        gameId,
        versionId,
        versionNumber,
        targetPath,
        recordedAtMillis,
    });
    if (!normalizedUserId || !normalized) return null;

    const target = getStorage(storage);
    if (!target) return normalized;
    const current = readInstalledCollaborationVersions(
        normalizedUserId,
        target,
    );
    target.setItem(
        getInstalledCollaborationVersionsKey(normalizedUserId),
        JSON.stringify({
            ...current,
            [normalized.collaborationId]: normalized,
        }),
    );
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent(
            INSTALLED_VERSION_CHANGED_EVENT,
            {detail: {userId: normalizedUserId}},
        ));
    }
    return normalized;
};

const getRemoteCurrentVersion = (collaboration) => {
    const value = collaboration?.currentVersion;
    const versionId = String(value?.versionId || '').trim();
    const versionNumber = Number(value?.number ?? value?.versionNumber);
    if (!versionId || !Number.isSafeInteger(versionNumber) ||
        versionNumber < 1) {
        return null;
    }
    return {
        versionId,
        versionNumber,
        originalFileName: value.originalFileName || null,
        uploadedByUsername: value.uploadedByUsername || null,
        uploadedAt: value.uploadedAt || null,
    };
};

export const findCollaborationVersionUpdates = (
    collaborations,
    installedVersions,
) => (Array.isArray(collaborations) ? collaborations : []).reduce(
    (updates, collaboration) => {
        const collaborationId = String(collaboration?.id || '').trim();
        const currentVersion = getRemoteCurrentVersion(collaboration);
        if (!collaborationId || !currentVersion) return updates;
        const installedVersion = installedVersions?.[collaborationId] || null;
        if (installedVersion?.versionId === currentVersion.versionId) {
            return updates;
        }
        updates.push({
            collaborationId,
            title: collaboration.title || 'Untitled collaboration',
            gameId: collaboration.game || null,
            currentVersion,
            installedVersion,
            reason: installedVersion ? 'different-version' : 'not-synced',
        });
        return updates;
    },
    [],
);

export const subscribeInstalledCollaborationVersions = (
    userId,
    listener,
) => {
    if (typeof window === 'undefined') return () => {};
    const normalizedUserId = String(userId || '').trim();
    const storageKey = getInstalledCollaborationVersionsKey(normalizedUserId);
    const handleCustom = (event) => {
        if (event.detail?.userId === normalizedUserId) {
            listener(readInstalledCollaborationVersions(normalizedUserId));
        }
    };
    const handleStorage = (event) => {
        if (event.key === storageKey) {
            listener(readInstalledCollaborationVersions(normalizedUserId));
        }
    };
    window.addEventListener(INSTALLED_VERSION_CHANGED_EVENT, handleCustom);
    window.addEventListener('storage', handleStorage);
    return () => {
        window.removeEventListener(INSTALLED_VERSION_CHANGED_EVENT, handleCustom);
        window.removeEventListener('storage', handleStorage);
    };
};
