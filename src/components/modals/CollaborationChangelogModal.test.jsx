import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { updateCollaborationChangelogEntry } from '../../firebase/collaboration';
import CollaborationChangelogModal from './CollaborationChangelogModal';

vi.mock('firebase/functions', () => ({
    getFunctions: vi.fn(),
    httpsCallable: vi.fn(),
}));

vi.mock('../../firebase/config', () => ({
    auth: {
        currentUser: {
            getIdToken: vi.fn(),
        },
    },
}));

vi.mock('../../firebase/collaboration', () => ({
    finalizeCollaborationVersion: vi.fn(),
    updateCollaborationChangelogEntry: vi.fn(),
}));

describe('CollaborationChangelogModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.electronAPI = {
            getLatestCollaborationFile: vi.fn().mockResolvedValue({
                success: true,
                filePath: 'C:\\Saves\\My Park.park2',
                fileName: 'My Park.park2',
                fileSize: 1024,
                modifiedAt: '2026-07-27T11:55:00.000Z',
                modifiedAtMs: Date.parse('2026-07-27T11:55:00.000Z'),
                ageMs: 5 * 60 * 1000,
                stale: true,
                nameMatchesExpected: true,
            }),
        };
    });

    afterEach(() => {
        delete window.electronAPI;
    });

    test('warns before uploading a save older than two minutes', async () => {
        render(
            <CollaborationChangelogModal
                collaborationId="collab-1"
                collaboration={{ game: 'planet-coaster-2' }}
                entry={{
                    id: 'entry-1',
                    userId: 'user-1',
                    hasSave: false,
                    versionId: null,
                }}
                currentVersion={{ originalFileName: 'My Park.park2' }}
                game={{ shortName: 'PC2' }}
                retentionLimit={3}
                accentColor="#2563EB"
                onClose={vi.fn()}
                onUploaded={vi.fn()}
                setModalMessage={vi.fn()}
            />,
        );

        expect(await screen.findByText('Save in the game before uploading.')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('What changed?'), {
            target: { value: 'Finished the entrance plaza.' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Upload newest' }));

        await waitFor(() => {
            expect(screen.getByRole('button', { name: 'Upload newest anyway' })).toBeInTheDocument();
        });
        expect(window.electronAPI.getLatestCollaborationFile).toHaveBeenCalledTimes(2);
    });

    test('lets only the entry editor update an existing changelog without another save upload', async () => {
        const onClose = vi.fn();
        const onUploaded = vi.fn();
        render(
            <CollaborationChangelogModal
                collaborationId="collab-1"
                collaboration={{ game: 'planet-coaster-2' }}
                entry={{
                    id: 'entry-2',
                    userId: 'user-1',
                    changelog: 'Original note',
                    imageUrls: [],
                    completedTodos: [{
                        id: 'todo-1',
                        text: 'Finish the entrance',
                    }],
                    hasSave: true,
                    versionId: 'version-2',
                }}
                currentVersion={{ originalFileName: 'My Park.park2' }}
                game={{ shortName: 'PC2' }}
                retentionLimit={3}
                accentColor="#2563EB"
                onClose={onClose}
                onUploaded={onUploaded}
                setModalMessage={vi.fn()}
            />,
        );

        expect(screen.queryByRole('button', { name: 'Upload newest' })).not.toBeInTheDocument();
        expect(screen.getByText('Finish the entrance')).toBeInTheDocument();
        fireEvent.change(screen.getByLabelText('What changed?'), {
            target: { value: 'Updated note' },
        });
        fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

        await waitFor(() => {
            expect(updateCollaborationChangelogEntry).toHaveBeenCalledWith(
                'collab-1',
                'entry-2',
                'Updated note',
                [],
                [{id: 'todo-1', text: 'Finish the entrance'}],
            );
            expect(onUploaded).toHaveBeenCalled();
            expect(onClose).toHaveBeenCalled();
        });
        expect(window.electronAPI.getLatestCollaborationFile).not.toHaveBeenCalled();
    });
});
