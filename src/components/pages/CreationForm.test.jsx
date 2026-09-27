import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { addDoc, writeBatch } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { scheduleCreationDataRefresh } from '../../utils/appRefresh';
import CreationForm from './CreationForm';

vi.mock('firebase/firestore', () => ({
    addDoc: vi.fn(),
    arrayUnion: vi.fn(),
    collection: vi.fn((...parts) => ({ path: parts.slice(1).join('/') })),
    doc: vi.fn((...parts) => ({ path: parts.slice(1).join('/') })),
    documentId: vi.fn(() => '__name__'),
    getDoc: vi.fn(async reference => {
        if (reference.path.startsWith('categories/')) return { exists: () => true, data: () => ({ names: ['Park', 'Coaster', 'Flatride', 'Scenery'] }) };
        if (reference.path.startsWith('dlcs/')) return { exists: () => true, data: () => ({ names: ['Vintage Funfair Ride Pack'] }) };
        if (reference.path.startsWith('profiles/')) return { exists: () => true, data: () => ({ username: 'Creator' }) };
        return { exists: () => false, data: () => ({}) };
    }),
    getDocs: vi.fn(async () => ({ empty: true, docs: [] })),
    query: vi.fn(value => value),
    serverTimestamp: vi.fn(() => 'server-time'),
    Timestamp: { now: vi.fn(() => 'now') },
    where: vi.fn(),
    writeBatch: vi.fn(() => ({ set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn() })),
}));

vi.mock('firebase/functions', () => ({
    getFunctions: vi.fn(),
    httpsCallable: vi.fn(),
}));

vi.mock('../../firebase/config', () => ({
    auth: { currentUser: { getIdToken: vi.fn() } },
    db: {},
}));

vi.mock('../../firebase/appCheck', () => ({ getAppCheckTokenIfAvailable: vi.fn() }));
vi.mock('../../utils/appRefresh', () => ({ scheduleDataRefresh: vi.fn(), scheduleCreationDataRefresh: vi.fn() }));

describe('CreationForm desktop savegame start', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        window.scrollTo = vi.fn();
        window.electronAPI = {
            isElectron: true,
            listAllLocalCreationsAndBackups: vi.fn().mockResolvedValue({
                'Planet Coaster 2': {
                    parks: [],
                    blueprints: [{
                        name: 'Arctic Launch.blpr2',
                        path: 'C:\\Frontier\\Arctic Launch.blpr2',
                        modifiedAt: '2026-08-20T10:00:00.000Z',
                        frontierMetadata: {
                            kind: 'blueprint',
                            name: 'Arctic Launch',
                            description: 'A frozen launch coaster.',
                            isModded: false,
                            requiredDlcs: ['Vintage Funfair Ride Pack'],
                            tags: ['Blueprint', 'Coasters'],
                            blueprint: {
                                trackedRideCount: 1,
                                rides: [{ kind: 'tracked', rideCategoryKey: 'coaster' }],
                            },
                        },
                    }],
                    backups: [],
                    autosaves: [],
                },
            }),
            readFrontierPreview: vi.fn().mockResolvedValue('data:image/jpeg;base64,preview'),
        };
    });

    afterEach(() => {
        delete window.electronAPI;
    });

    test('asks first and prefills editable fields from the selected save', async () => {
        render(
            <MemoryRouter>
                <CreationForm
                    user={{ uid: 'creator-1' }}
                    userProfile={{ ownedDlcs: {} }}
                    setModalMessage={vi.fn()}
                    initialGame="planet-coaster-2"
                    blacklist={[]}
                />
            </MemoryRouter>,
        );

        expect(screen.getByRole('heading', { name: 'Would you like to attach a savegame?' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Yes, select a savegame/i }));
        fireEvent.click(await screen.findByRole('button', { name: /Arctic Launch\.blpr2/i }));
        expect(await screen.findByAltText('In-game save preview')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Confirm Selection' }));

        await waitFor(() => expect(screen.getByText('Selected savegame')).toBeInTheDocument());
        fireEvent.click(screen.getByRole('button', { name: /Details/i }));

        expect(await screen.findByDisplayValue('Arctic Launch')).toBeInTheDocument();
        expect(screen.getByDisplayValue('A frozen launch coaster.')).toBeInTheDocument();
        expect(screen.getByText('In-game tags')).toBeInTheDocument();
        expect(screen.getByText('Coasters')).toBeInTheDocument();
        expect(screen.getByText('0 / 10')).toBeInTheDocument();
        expect(screen.getByPlaceholderText('Add tags with spacebar...')).toBeEnabled();
        expect(screen.getByText('1 DLC(s) selected')).toBeInTheDocument();
    });

    test('adds the Attractions & Areas step only after selecting Park', async () => {
        render(
            <MemoryRouter>
                <CreationForm
                    user={{ uid: 'creator-1' }}
                    userProfile={{ ownedDlcs: {} }}
                    setModalMessage={vi.fn()}
                    initialGame="planet-coaster-2"
                    blacklist={[]}
                />
            </MemoryRouter>,
        );

        expect(screen.queryByRole('button', { name: /Attractions & Areas/i })).not.toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Details/i }));
        fireEvent.click(await screen.findByRole('button', { name: 'Park' }));
        expect(screen.getByRole('button', { name: /Attractions & Areas/i })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: /Attractions & Areas/i }));
        expect(screen.getByRole('heading', { name: 'Areas' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Attractions' })).toBeInTheDocument();
        expect(screen.getByLabelText('Attraction category')).toHaveValue('restaurant');
        expect(screen.getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
        expect(screen.getByRole('button', { name: 'Rides' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Venues' })).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Venues' }));
        expect(screen.getByRole('button', { name: 'Restaurants' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Shops' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Shows' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Restaurant' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Shop' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Show' })).toBeInTheDocument();
    });

    test.each([true, false])('normal users can save a new tag with attached savegame=%s', async attachSavegame => {
        const setModalMessage = vi.fn();
        const validateContentText = vi.fn().mockResolvedValue({ data: {} });
        const finalizeBackupUpload = vi.fn().mockResolvedValue({ data: { success: true } });
        httpsCallable.mockImplementation((functions, name) => ({
            validateContentText,
            finalizeBackupUpload,
        })[name]);
        addDoc.mockResolvedValue({ id: 'new-creation' });
        // Mirror the moderator-only tag catalog rule. A denied catalog write
        // must never prevent saving a user's creation or finalizing its upload.
        const catalogWrites = [];
        writeBatch.mockImplementation(() => ({
            set: vi.fn(reference => catalogWrites.push(reference.path)),
            commit: vi.fn(async () => {
                if (catalogWrites.some(path => path.startsWith('tags/'))) {
                    throw new Error('Missing or insufficient permissions.');
                }
            }),
        }));
        window.electronAPI.prepareBackupForUpload = vi.fn().mockResolvedValue({
            success: true,
            fileName: 'Arctic Launch.PlanetCreations',
            uploadHandle: 'prepared-backup',
            isSigned: true,
        });
        window.electronAPI.uploadPreparedBackup = vi.fn().mockResolvedValue({
            success: true,
            uploadId: 'uploaded-backup',
        });

        render(
            <MemoryRouter>
                <CreationForm
                    user={{ uid: 'creator-1' }}
                    userProfile={{ role: 'user', ownedDlcs: {} }}
                    setModalMessage={setModalMessage}
                    initialGame="planet-coaster-2"
                    blacklist={[]}
                />
            </MemoryRouter>,
        );

        if (attachSavegame) {
            fireEvent.click(screen.getByRole('button', { name: /Yes, select a savegame/i }));
            fireEvent.click(await screen.findByRole('button', { name: /Arctic Launch\.blpr2/i }));
            fireEvent.click(screen.getByRole('button', { name: 'Confirm Selection' }));
            fireEvent.click(screen.getByRole('checkbox', { name: /I confirm that this is my own creation/i }));
            fireEvent.click(screen.getByRole('checkbox', { name: /I agree that this file may be uploaded/i }));
            fireEvent.click(screen.getByRole('button', { name: 'Attach & Continue' }));
            await screen.findByDisplayValue('Arctic Launch');
        } else {
            fireEvent.click(screen.getByRole('button', { name: /Continue without/i }));
            fireEvent.click(screen.getByRole('button', { name: /Details/i }));
            fireEvent.click(await screen.findByRole('button', { name: 'Coaster' }));
            const [title, description] = screen.getAllByRole('textbox');
            fireEvent.change(title, { target: { value: 'Arctic Launch' } });
            fireEvent.change(description, { target: { value: 'A frozen launch coaster.' } });
        }
        const tagInput = screen.getByPlaceholderText('Add tags with spacebar...');
        fireEvent.change(tagInput, { target: { value: 'winter' } });
        fireEvent.keyDown(tagInput, { key: ' ' });
        fireEvent.click(screen.getByRole('button', { name: /Sharing/i }));
        fireEvent.change(screen.getAllByRole('textbox')[0], { target: { value: 'ABC-123' } });
        fireEvent.click(screen.getByRole('button', { name: /Communitys/i }));
        const submit = screen.getByRole('button', { name: 'Create Creation' });
        await waitFor(() => expect(submit).toBeEnabled());
        fireEvent.click(submit);

        await waitFor(() => expect(addDoc).toHaveBeenCalledWith(
            { path: 'creations' },
            expect.objectContaining({ userId: 'creator-1', tags: ['winter'], title: 'Arctic Launch' }),
        ));
        expect(catalogWrites).toEqual([]);
        if (attachSavegame) {
            await waitFor(() => expect(finalizeBackupUpload).toHaveBeenCalledWith({
                uploadId: 'uploaded-backup', creationId: 'new-creation',
            }));
        } else {
            await waitFor(() => expect(setModalMessage).toHaveBeenCalledWith('Creation submitted successfully!'));
            expect(finalizeBackupUpload).not.toHaveBeenCalled();
        }
        expect(setModalMessage).not.toHaveBeenCalledWith(expect.stringContaining('permissions'));
        await waitFor(() => expect(scheduleCreationDataRefresh).toHaveBeenCalledWith({
            game: 'planet-coaster-2', creationId: 'new-creation',
        }));
    });
});
