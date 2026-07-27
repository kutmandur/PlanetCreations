import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
    fetchUserCollaborationsForGame,
    getCollaborationVersionDownloadUrl,
} from '../../firebase/collaboration';
import {
    readInstalledCollaborationVersions,
    recordInstalledCollaborationVersion,
} from '../../utils/collaborationVersionUpdates';
import CollaborationOverlayControls from './CollaborationOverlayControls';

jest.mock('../../firebase/collaboration', () => ({
    endBuildSession: jest.fn(),
    fetchUserCollaborationsForGame: jest.fn(),
    getCollaborationVersionDownloadUrl: jest.fn(),
    startBuildSession: jest.fn(),
}));

const collaboration = {
    id: 'collab-1',
    title: 'Shared Park',
    game: 'planet-coaster-2',
    status: 'active',
    currentVersion: {
        versionId: 'version-3',
        number: 3,
        originalFileName: 'Shared Park.park2',
    },
};

describe('CollaborationOverlayControls version updates', () => {
    beforeEach(() => {
        localStorage.clear();
        jest.clearAllMocks();
        fetchUserCollaborationsForGame.mockResolvedValue([collaboration]);
        getCollaborationVersionDownloadUrl.mockResolvedValue({
            downloadUrl: 'https://account.r2.cloudflarestorage.com/signed',
        });
        window.electronAPI = {
            saveCollaborationVersion: jest.fn().mockResolvedValue({
                success: true,
                targetPath: 'C:\\Saves\\Shared Park.park2',
            }),
        };
    });

    afterEach(() => {
        delete window.electronAPI;
    });

    test('offers and records the current version when a newer one exists', async () => {
        recordInstalledCollaborationVersion({
            userId: 'user-1',
            collaborationId: 'collab-1',
            gameId: 'planet-coaster-2',
            versionId: 'version-2',
            versionNumber: 2,
            targetPath: 'C:\\Saves\\Shared Park.park2',
        });
        const setModalMessage = jest.fn();

        render(
            <CollaborationOverlayControls
                user={{uid: 'user-1', displayName: 'Builder'}}
                activeGameId="planet-coaster-2"
                currentPath="/"
                onOpenCollaboration={jest.fn()}
                setModalMessage={setModalMessage}
            />,
        );

        fireEvent.click(await screen.findByRole('button', {
            name: 'Install v3',
        }));

        await waitFor(() => {
            expect(getCollaborationVersionDownloadUrl).toHaveBeenCalledWith(
                'collab-1',
                'version-3',
            );
            expect(window.electronAPI.saveCollaborationVersion)
                .toHaveBeenCalledWith({
                    downloadUrl: 'https://account.r2.cloudflarestorage.com/signed',
                    gameId: 'planet-coaster-2',
                    suggestedTargetPath: 'C:\\Saves\\Shared Park.park2',
                });
            expect(setModalMessage).toHaveBeenCalledWith(
                'Version 3 of Shared Park saved to C:\\Saves\\Shared Park.park2.',
            );
        });

        expect(readInstalledCollaborationVersions('user-1')['collab-1'])
            .toEqual(expect.objectContaining({
                versionId: 'version-3',
                versionNumber: 3,
            }));
        expect(screen.queryByRole('button', {name: 'Install v3'}))
            .not.toBeInTheDocument();
    });
});
