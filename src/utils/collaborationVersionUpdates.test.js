import {
    findCollaborationVersionUpdates,
    readInstalledCollaborationVersions,
    recordInstalledCollaborationVersion,
} from './collaborationVersionUpdates';

const createStorage = () => {
    const values = new Map();
    return {
        getItem: (key) => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
    };
};

const collaboration = {
    id: 'collab-1',
    title: 'Shared Park',
    game: 'planet-coaster-2',
    currentVersion: {
        versionId: 'version-3',
        number: 3,
        originalFileName: 'Shared Park.park2',
    },
};

test('offers the current collaboration version when this device is not synced', () => {
    expect(findCollaborationVersionUpdates([collaboration], {})).toEqual([
        expect.objectContaining({
            collaborationId: 'collab-1',
            reason: 'not-synced',
            currentVersion: expect.objectContaining({
                versionId: 'version-3',
                versionNumber: 3,
            }),
        }),
    ]);
});
test('does not offer an update when the exact current version is installed', () => {
    const updates = findCollaborationVersionUpdates([collaboration], {
        'collab-1': {
            collaborationId: 'collab-1',
            gameId: 'planet-coaster-2',
            versionId: 'version-3',
            versionNumber: 3,
        },
    });
    expect(updates).toEqual([]);
});

test('uses the version id instead of trusting only a version number', () => {
    const updates = findCollaborationVersionUpdates([collaboration], {
        'collab-1': {
            collaborationId: 'collab-1',
            gameId: 'planet-coaster-2',
            versionId: 'different-version',
            versionNumber: 3,
        },
    });
    expect(updates).toEqual([
        expect.objectContaining({reason: 'different-version'}),
    ]);
});

test('persists installed versions separately for each signed-in user', () => {
    const storage = createStorage();
    recordInstalledCollaborationVersion({
        userId: 'user-1',
        collaborationId: 'collab-1',
        gameId: 'planet-coaster-2',
        versionId: 'version-3',
        versionNumber: 3,
        recordedAtMillis: 1234,
    }, storage);

    expect(readInstalledCollaborationVersions('user-1', storage)).toEqual({
        'collab-1': {
            collaborationId: 'collab-1',
            gameId: 'planet-coaster-2',
            versionId: 'version-3',
            versionNumber: 3,
            recordedAtMillis: 1234,
        },
    });
    expect(readInstalledCollaborationVersions('user-2', storage)).toEqual({});
});
