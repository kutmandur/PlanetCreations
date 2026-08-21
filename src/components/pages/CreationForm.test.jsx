import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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

describe('CreationForm desktop savegame start', () => {
    beforeEach(() => {
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
});
