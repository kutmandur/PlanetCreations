import {
    clearCollaborationBuildDraft,
    ensureCollaborationBuildDraft,
    getCollaborationBuildDraftPayload,
    readCollaborationBuildDraft,
    setCollaborationBuildDraftTodo,
    updateCollaborationBuildDraft,
} from './collaborationBuildDraft';

const createStorage = () => {
    const values = new Map();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
        removeItem: (key) => values.delete(key),
    };
};

const session = {
    collaborationId: 'collab-1',
    userId: 'user-1',
    gameId: 'planet-coaster-2',
    buildSessionId: 'session-1',
};

test('keeps notes and completed todo snapshots in a local build draft', () => {
    const storage = createStorage();
    ensureCollaborationBuildDraft(session, storage);
    updateCollaborationBuildDraft(
        'collab-1',
        'user-1',
        { changelog: 'Reworked the entrance.' },
        storage,
    );
    setCollaborationBuildDraftTodo(
        'collab-1',
        'user-1',
        { id: 'todo-1', text: 'Finish entrance' },
        true,
        storage,
    );

    expect(getCollaborationBuildDraftPayload(
        readCollaborationBuildDraft('collab-1', 'user-1', storage),
    )).toEqual({
        changelog: 'Reworked the entrance.',
        completedTodos: [{ id: 'todo-1', text: 'Finish entrance' }],
    });
});

test('starts clean for a new build session but preserves the same session', () => {
    const storage = createStorage();
    ensureCollaborationBuildDraft(session, storage);
    updateCollaborationBuildDraft(
        'collab-1',
        'user-1',
        { changelog: 'Keep me' },
        storage,
    );

    expect(ensureCollaborationBuildDraft(session, storage).changelog).toBe('Keep me');
    expect(ensureCollaborationBuildDraft({
        ...session,
        buildSessionId: 'session-2',
    }, storage).changelog).toBe('');
});

test('removes recovered local data only after a successful hand-off', () => {
    const storage = createStorage();
    ensureCollaborationBuildDraft(session, storage);

    expect(clearCollaborationBuildDraft('collab-1', 'user-1', storage)).toBe(true);
    expect(readCollaborationBuildDraft('collab-1', 'user-1', storage)).toBeNull();
});
