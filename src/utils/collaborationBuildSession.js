import {
    clearCollaborationBuildDraft,
    getCollaborationBuildDraftPayload,
    readCollaborationBuildDraft,
} from './collaborationBuildDraft';

export const ACTIVE_COLLABORATION_BUILD_KEY = 'planetcreations.activeCollaborationBuild';
const ACTIVE_BUILD_CHANGED_EVENT =
    'planetcreations:active-collaboration-build-changed';

const getStorage = (storage) => {
    if (storage) return storage;
    if (typeof window === 'undefined') return null;
    return window.localStorage;
};

const notifyActiveBuildChanged = () => {
    if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(ACTIVE_BUILD_CHANGED_EVENT));
    }
};

const normalizeSession = (value) => {
    if (!value || typeof value !== 'object') return null;
    const collaborationId = String(value.collaborationId || '').trim();
    const gameId = String(value.gameId || '').trim();
    const userId = String(value.userId || '').trim();
    if (!collaborationId || !gameId || !userId) return null;
    const pendingEnd = value.pendingEnd === true;
    const pendingEndedAtMillis = Number(value.pendingEndedAtMillis);
    const normalized = {
        collaborationId,
        gameId,
        userId,
        pendingEnd,
    };
    const buildSessionId = String(value.buildSessionId || '').trim();
    if (buildSessionId) normalized.buildSessionId = buildSessionId;
    if (pendingEnd && Number.isFinite(pendingEndedAtMillis) &&
        pendingEndedAtMillis > 0) {
        normalized.pendingEndedAtMillis = pendingEndedAtMillis;
    }
    return normalized;
};

export const readActiveCollaborationBuild = (storage) => {
    const target = getStorage(storage);
    if (!target) return null;
    try {
        return normalizeSession(JSON.parse(target.getItem(ACTIVE_COLLABORATION_BUILD_KEY)));
    } catch (error) {
        return null;
    }
};

export const rememberActiveCollaborationBuild = (session, storage) => {
    const normalized = normalizeSession({ ...session, pendingEnd: false });
    if (!normalized) throw new Error('A collaboration, game and user are required.');
    const target = getStorage(storage);
    if (target) {
        target.setItem(
            ACTIVE_COLLABORATION_BUILD_KEY,
            JSON.stringify(normalized),
        );
        notifyActiveBuildChanged();
    }
    return normalized;
};

export const markCollaborationBuildPendingEnd = (
    collaborationId,
    storage,
    endedAtMillis = Date.now(),
) => {
    const current = readActiveCollaborationBuild(storage);
    if (!current || current.collaborationId !== collaborationId) return null;
    const recordedEnd = current.pendingEndedAtMillis ||
        (Number.isFinite(endedAtMillis) && endedAtMillis > 0
            ? endedAtMillis
            : Date.now());
    const pending = {
        ...current,
        pendingEnd: true,
        pendingEndedAtMillis: recordedEnd,
    };
    const target = getStorage(storage);
    if (target) {
        target.setItem(
            ACTIVE_COLLABORATION_BUILD_KEY,
            JSON.stringify(pending),
        );
        notifyActiveBuildChanged();
    }
    return pending;
};

export const clearActiveCollaborationBuild = (collaborationId, storage) => {
    const target = getStorage(storage);
    if (!target) return false;
    const current = readActiveCollaborationBuild(target);
    if (collaborationId && current?.collaborationId !== collaborationId) return false;
    target.removeItem(ACTIVE_COLLABORATION_BUILD_KEY);
    notifyActiveBuildChanged();
    return true;
};

export const subscribeActiveCollaborationBuild = (listener) => {
    if (typeof window === 'undefined') return () => {};
    const handleChange = () => listener(readActiveCollaborationBuild());
    const handleStorage = (event) => {
        if (event.key === ACTIVE_COLLABORATION_BUILD_KEY) handleChange();
    };
    window.addEventListener(ACTIVE_BUILD_CHANGED_EVENT, handleChange);
    window.addEventListener('storage', handleStorage);
    return () => {
        window.removeEventListener(ACTIVE_BUILD_CHANGED_EVENT, handleChange);
        window.removeEventListener('storage', handleStorage);
    };
};

const isTerminalEndError = (error) => {
    const code = String(error?.code || '').toLowerCase();
    return code.endsWith('permission-denied') || code.endsWith('not-found');
};

/**
 * End the remembered build for a stopped game. The pending marker is written
 * before the network call, so an offline/crashed client can retry on next boot.
 */
export const endRememberedCollaborationBuild = async ({
    userId,
    gameId,
    endSession,
    storage,
    pendingOnly = false,
}) => {
    const current = readActiveCollaborationBuild(storage);
    if (!current || current.userId !== userId) return { ended: false, reason: 'no-session' };
    if (gameId && current.gameId !== gameId) return { ended: false, reason: 'different-game' };
    if (pendingOnly && !current.pendingEnd) return { ended: false, reason: 'not-pending' };

    const pending = markCollaborationBuildPendingEnd(
        current.collaborationId,
        storage,
    );
    const localDraft = readCollaborationBuildDraft(
        current.collaborationId,
        current.userId,
        storage,
    );
    const draftPayload = getCollaborationBuildDraftPayload(localDraft);
    try {
        const endResult = await endSession(
            current.collaborationId,
            pending?.pendingEndedAtMillis,
            draftPayload,
            current.buildSessionId || null,
        );
        clearActiveCollaborationBuild(current.collaborationId, storage);
        clearCollaborationBuildDraft(
            current.collaborationId,
            current.userId,
            storage,
        );
        return {
            ended: true,
            collaborationId: current.collaborationId,
            buildDraft: draftPayload,
            ...(endResult || {}),
        };
    } catch (error) {
        // A missing collaboration or a foreign lock means the local marker is
        // stale; retrying forever would never help.
        if (isTerminalEndError(error)) {
            clearActiveCollaborationBuild(current.collaborationId, storage);
        }
        throw error;
    }
};
