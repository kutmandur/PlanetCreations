export const COLLABORATION_BUILD_DRAFT_PREFIX =
    'planetcreations.collaborationBuildDraft';

const getStorage = (storage) => {
    if (storage) return storage;
    if (typeof window === 'undefined') return null;
    return window.localStorage;
};

const draftKey = (collaborationId, userId) =>
    `${COLLABORATION_BUILD_DRAFT_PREFIX}.${collaborationId}.${userId}`;

const normalizeCompletedTodo = (todo) => {
    if (!todo || typeof todo !== 'object') return null;
    const id = String(todo.id || '').trim();
    const text = String(todo.text || '').trim();
    if (!id || !text) return null;
    return { id, text: text.slice(0, 300) };
};

const normalizeDraft = (value, collaborationId, userId) => {
    if (!value || typeof value !== 'object') return null;
    if (value.collaborationId !== collaborationId || value.userId !== userId) {
        return null;
    }
    const completedTodos = Array.isArray(value.completedTodos)
        ? value.completedTodos
            .map(normalizeCompletedTodo)
            .filter(Boolean)
            .filter((todo, index, items) =>
                items.findIndex((item) => item.id === todo.id) === index)
            .slice(0, 50)
        : [];
    return {
        collaborationId,
        userId,
        gameId: String(value.gameId || '').trim(),
        buildSessionId: String(value.buildSessionId || '').trim(),
        changelog: String(value.changelog || '').slice(0, 1000),
        completedTodos,
        updatedAtMillis: Number.isFinite(Number(value.updatedAtMillis))
            ? Number(value.updatedAtMillis)
            : Date.now(),
    };
};

const writeDraft = (draft, storage) => {
    const target = getStorage(storage);
    if (target) {
        target.setItem(
            draftKey(draft.collaborationId, draft.userId),
            JSON.stringify(draft),
        );
    }
    return draft;
};

export const readCollaborationBuildDraft = (
    collaborationId,
    userId,
    storage,
) => {
    const target = getStorage(storage);
    if (!target || !collaborationId || !userId) return null;
    try {
        return normalizeDraft(
            JSON.parse(target.getItem(draftKey(collaborationId, userId))),
            collaborationId,
            userId,
        );
    } catch (error) {
        return null;
    }
};

export const ensureCollaborationBuildDraft = (session, storage) => {
    const collaborationId = String(session?.collaborationId || '').trim();
    const userId = String(session?.userId || '').trim();
    if (!collaborationId || !userId) {
        throw new Error('A collaboration and user are required for a build draft.');
    }
    const buildSessionId = String(session?.buildSessionId || '').trim();
    const existing = readCollaborationBuildDraft(
        collaborationId,
        userId,
        storage,
    );
    const belongsToSession = existing && (
        !buildSessionId ||
        !existing.buildSessionId ||
        existing.buildSessionId === buildSessionId
    );
    if (belongsToSession) {
        return writeDraft({
            ...existing,
            gameId: String(session?.gameId || existing.gameId || '').trim(),
            buildSessionId: buildSessionId || existing.buildSessionId,
        }, storage);
    }
    return writeDraft({
        collaborationId,
        userId,
        gameId: String(session?.gameId || '').trim(),
        buildSessionId,
        changelog: '',
        completedTodos: [],
        updatedAtMillis: Date.now(),
    }, storage);
};

export const updateCollaborationBuildDraft = (
    collaborationId,
    userId,
    updates,
    storage,
) => {
    const current = readCollaborationBuildDraft(
        collaborationId,
        userId,
        storage,
    ) || ensureCollaborationBuildDraft({ collaborationId, userId }, storage);
    return writeDraft(normalizeDraft({
        ...current,
        ...updates,
        collaborationId,
        userId,
        updatedAtMillis: Date.now(),
    }, collaborationId, userId), storage);
};

export const setCollaborationBuildDraftTodo = (
    collaborationId,
    userId,
    todo,
    completed,
    storage,
) => {
    const current = readCollaborationBuildDraft(
        collaborationId,
        userId,
        storage,
    ) || ensureCollaborationBuildDraft({ collaborationId, userId }, storage);
    const normalizedTodo = normalizeCompletedTodo(todo);
    const withoutTodo = current.completedTodos.filter(
        (item) => item.id !== normalizedTodo?.id,
    );
    return updateCollaborationBuildDraft(
        collaborationId,
        userId,
        {
            completedTodos: completed && normalizedTodo
                ? [...withoutTodo, normalizedTodo]
                : withoutTodo,
        },
        storage,
    );
};

export const clearCollaborationBuildDraft = (
    collaborationId,
    userId,
    storage,
) => {
    const target = getStorage(storage);
    if (!target || !collaborationId || !userId) return false;
    target.removeItem(draftKey(collaborationId, userId));
    return true;
};

export const getCollaborationBuildDraftPayload = (draft) => ({
    changelog: String(draft?.changelog || '').slice(0, 1000),
    completedTodos: Array.isArray(draft?.completedTodos)
        ? draft.completedTodos.map(normalizeCompletedTodo).filter(Boolean).slice(0, 50)
        : [],
});
