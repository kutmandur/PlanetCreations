import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CreateCollaborationForm from './CreateCollaborationForm';

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
    db: {},
}));

vi.mock('../../firebase/collaboration', () => ({
    createCollaboration: vi.fn(),
    fetchCollaborationById: vi.fn(),
    updateCollaborationSettings: vi.fn(),
}));

vi.mock('../../utils/collaborationVersionUpdates', () => ({
    recordInstalledCollaborationVersion: vi.fn(),
}));

describe('CreateCollaborationForm', () => {
    beforeEach(() => {
        window.scrollTo = vi.fn();
        window.electronAPI = {
            isElectron: true,
            listAllLocalCreationsAndBackups: vi.fn().mockResolvedValue({
                'Planet Coaster 2': {
                    parks: [{
                        name: 'Shared Park.park2',
                        path: 'C:\\Frontier\\Shared Park.park2',
                        size: 2048,
                        modifiedAt: '2026-07-28T08:00:00.000Z',
                    }],
                    blueprints: [],
                    backups: [],
                    autosaves: [],
                },
            }),
        };
    });

    afterEach(() => {
        delete window.electronAPI;
    });

    test('uses the normal creation file selector for the required initial save', async () => {
        render(
            <MemoryRouter>
                <CreateCollaborationForm
                    user={{ uid: 'owner-1' }}
                    setModalMessage={vi.fn()}
                />
            </MemoryRouter>,
        );

        fireEvent.click(screen.getByRole('button', { name: /Initial save/i }));
        fireEvent.click(screen.getByRole('button', { name: /Choose initial save file/i }));

        expect(await screen.findByRole('heading', { name: 'Select a Creation File' })).toBeInTheDocument();
        expect(window.electronAPI.listAllLocalCreationsAndBackups).toHaveBeenCalledTimes(1);

        fireEvent.click(await screen.findByRole('button', { name: /Shared Park\.park2/i }));
        fireEvent.click(screen.getByRole('button', { name: 'Confirm Selection' }));

        await waitFor(() => {
            expect(screen.queryByRole('heading', { name: 'Select a Creation File' })).not.toBeInTheDocument();
        });
        expect(screen.getByText('Shared Park.park2')).toBeInTheDocument();
        expect(screen.getByText('2 KB')).toBeInTheDocument();
    });
});
