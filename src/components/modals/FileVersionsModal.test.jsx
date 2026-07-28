import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import FileVersionsModal from './FileVersionsModal';
import {
    fetchFileVersions,
    getCollaborationVersionDownloadUrl,
} from '../../firebase/collaboration';
import { readInstalledCollaborationVersions } from '../../utils/collaborationVersionUpdates';

vi.mock('../../firebase/collaboration', () => ({
    fetchFileVersions: vi.fn(),
    getCollaborationVersionDownloadUrl: vi.fn(),
}));
vi.mock('../../utils/helpers', () => ({
    ICONS: {
        download: '',
        refresh: '',
        xMark: '',
    },
}));

const version = {
    id: 'version-1',
    versionNumber: 1,
    uploadedBy: 'user-1',
    uploadedByUsername: 'Builder',
    uploadedAt: new Date('2026-07-25T08:00:00Z'),
    sizeBytes: 1024,
    note: 'Entrance finished',
    isCurrentVersion: true,
};

describe('FileVersionsModal', () => {
    beforeEach(() => {
        localStorage.clear();
        fetchFileVersions.mockResolvedValue({
            all: [version],
            byUser: [{
                userId: 'user-1',
                username: 'Builder',
                versions: [version],
            }],
        });
        getCollaborationVersionDownloadUrl.mockResolvedValue({
            downloadUrl: 'https://example.r2.cloudflarestorage.com/signed',
        });
        window.electronAPI = {
            saveCollaborationVersion: vi.fn().mockResolvedValue({
                success: true,
                targetPath: 'C:\\Saves\\park.park2',
            }),
        };
    });

    afterEach(() => {
        delete window.electronAPI;
        vi.clearAllMocks();
    });

    test('loads retained versions and hands a signed download to Electron', async () => {
        const setModalMessage = vi.fn();
        render(
            <FileVersionsModal
                collaborationId="collab-1"
                fileId="save"
                file={{ name: 'park.park2' }}
                gameId="planet-coaster-2"
                currentUserId="user-1"
                retentionLimit={3}
                isElectron
                onClose={vi.fn()}
                setModalMessage={setModalMessage}
            />,
        );

        expect(await screen.findByText(/Entrance finished/)).toBeInTheDocument();
        expect(screen.getByText(/Up to/i)).toHaveTextContent('Up to 3 versions are kept per contributor.');

        fireEvent.click(screen.getByRole('button', { name: 'Download version 1' }));

        await waitFor(() => {
            expect(getCollaborationVersionDownloadUrl).toHaveBeenCalledWith(
                'collab-1',
                'version-1',
            );
            expect(window.electronAPI.saveCollaborationVersion).toHaveBeenCalledWith({
                downloadUrl: 'https://example.r2.cloudflarestorage.com/signed',
                gameId: 'planet-coaster-2',
            });
            expect(setModalMessage).toHaveBeenCalledWith(
                'Version 1 saved to C:\\Saves\\park.park2.',
            );
        });
        expect(readInstalledCollaborationVersions('user-1')['collab-1'])
            .toEqual(expect.objectContaining({
                versionId: 'version-1',
                versionNumber: 1,
            }));
    });
});
