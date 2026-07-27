import {
    ACTIVE_COLLABORATION_BUILD_KEY,
    clearActiveCollaborationBuild,
    endRememberedCollaborationBuild,
    readActiveCollaborationBuild,
    rememberActiveCollaborationBuild,
} from './collaborationBuildSession';
import {
    ensureCollaborationBuildDraft,
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
    gameId: 'planet-coaster-2',
    userId: 'user-1',
};

test('remembers and clears an active collaboration build', () => {
    const storage = createStorage();
    rememberActiveCollaborationBuild(session, storage);

    expect(readActiveCollaborationBuild(storage)).toEqual({
        ...session,
        pendingEnd: false,
    });
    expect(clearActiveCollaborationBuild('collab-1', storage)).toBe(true);
    expect(storage.getItem(ACTIVE_COLLABORATION_BUILD_KEY)).toBeNull();
});

test('ends only the build matching the stopped game', async () => {
    const storage = createStorage();
    const endSession = jest.fn().mockResolvedValue({
        changelogEntryId: 'entry-1',
        username: 'Builder',
    });
    rememberActiveCollaborationBuild(session, storage);

    await expect(endRememberedCollaborationBuild({
        userId: 'user-1',
        gameId: 'planet-zoo',
        endSession,
        storage,
    })).resolves.toEqual({ ended: false, reason: 'different-game' });
    expect(endSession).not.toHaveBeenCalled();

    await expect(endRememberedCollaborationBuild({
        userId: 'user-1',
        gameId: 'planet-coaster-2',
        endSession,
        storage,
    })).resolves.toEqual({
        ended: true,
        collaborationId: 'collab-1',
        buildDraft: {
            changelog: '',
            completedTodos: [],
        },
        changelogEntryId: 'entry-1',
        username: 'Builder',
    });
    expect(endSession).toHaveBeenCalledWith(
        'collab-1',
        expect.any(Number),
        {changelog: '', completedTodos: []},
        null,
    );
    expect(readActiveCollaborationBuild(storage)).toBeNull();
});

test('keeps a pending marker after a retryable network failure', async () => {
    const storage = createStorage();
    rememberActiveCollaborationBuild(session, storage);

    await expect(endRememberedCollaborationBuild({
        userId: 'user-1',
        gameId: 'planet-coaster-2',
        endSession: jest.fn().mockRejectedValue(new Error('offline')),
        storage,
    })).rejects.toThrow('offline');

    expect(readActiveCollaborationBuild(storage)).toEqual(expect.objectContaining({
        ...session,
        pendingEnd: true,
        pendingEndedAtMillis: expect.any(Number),
    }));
});

test('retries only sessions previously marked for ending', async () => {
    const storage = createStorage();
    const endSession = jest.fn().mockResolvedValue(undefined);
    rememberActiveCollaborationBuild(session, storage);

    await expect(endRememberedCollaborationBuild({
        userId: 'user-1',
        endSession,
        storage,
        pendingOnly: true,
    })).resolves.toEqual({ ended: false, reason: 'not-pending' });
    expect(endSession).not.toHaveBeenCalled();
});

test('keeps the original automatic-end timestamp across an offline retry', async () => {
    const storage = createStorage();
    const now = jest.spyOn(Date, 'now');
    rememberActiveCollaborationBuild(session, storage);
    now.mockReturnValueOnce(1000);

    await expect(endRememberedCollaborationBuild({
        userId: 'user-1',
        gameId: 'planet-coaster-2',
        endSession: jest.fn().mockRejectedValue(new Error('offline')),
        storage,
    })).rejects.toThrow('offline');

    now.mockReturnValue(5000);
    const endSession = jest.fn().mockResolvedValue({});
    await endRememberedCollaborationBuild({
        userId: 'user-1',
        endSession,
        storage,
        pendingOnly: true,
    });

    expect(endSession).toHaveBeenCalledWith(
        'collab-1',
        1000,
        {changelog: '', completedTodos: []},
        null,
    );
    now.mockRestore();
});

test('hands the recovered local draft to the end callable before clearing it', async () => {
    const storage = createStorage();
    const activeSession = {...session, buildSessionId: 'session-1'};
    rememberActiveCollaborationBuild(activeSession, storage);
    ensureCollaborationBuildDraft(activeSession, storage);
    updateCollaborationBuildDraft(
        'collab-1',
        'user-1',
        {changelog: 'Built a new station.'},
        storage,
    );
    setCollaborationBuildDraftTodo(
        'collab-1',
        'user-1',
        {id: 'todo-1', text: 'Finish station'},
        true,
        storage,
    );
    const endSession = jest.fn().mockResolvedValue({
        changelogEntryId: 'entry-1',
    });

    await endRememberedCollaborationBuild({
        userId: 'user-1',
        gameId: 'planet-coaster-2',
        endSession,
        storage,
    });

    expect(endSession).toHaveBeenCalledWith(
        'collab-1',
        expect.any(Number),
        {
            changelog: 'Built a new station.',
            completedTodos: [{id: 'todo-1', text: 'Finish station'}],
        },
        'session-1',
    );
    expect(readCollaborationBuildDraft(
        'collab-1',
        'user-1',
        storage,
    )).toBeNull();
});
