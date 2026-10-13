import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CreationDetail from './CreationDetail';

vi.mock('../../firebase/config', () => ({ db: {}, auth: {} }));
vi.mock('../../contexts/BlockingContext', () => ({
    useUserBlocks: () => ({ isBlocked: () => false }),
}));
vi.mock('../ui/ContentReportButton', () => ({ default: () => <button>Report Creation</button> }));
vi.mock('firebase/functions', () => ({
    getFunctions: () => null,
    httpsCallable: () => vi.fn().mockResolvedValue({ data: {} }),
}));
vi.mock('firebase/firestore', async importOriginal => ({
    ...await importOriginal(),
    doc: (...parts) => ({ path: parts.slice(1).join('/') }),
    getDoc: vi.fn().mockResolvedValue({ exists: () => false }),
    onSnapshot: (reference, options, callback) => {
        if (reference.path === 'creations/example') {
            callback({ id: 'example', exists: () => true, metadata: { fromCache: false },
                data: () => ({ name: 'Example park', title: 'Example park', game: 'Planet Coaster 2',
                    userId: 'creator', username: 'Creator', description: 'A park description', tags: [] }) });
        }
        return () => {};
    },
}));

describe('CreationDetail opening', () => {
    it.each([undefined, { clients: { desktop: { remoteInstall: true, displayName: 'Desktop' } } }])(
        'opens a creation with profile %j after Direct Install removal', async userProfile => {
            window.matchMedia = vi.fn(() => ({ matches: false }));
            window.scrollTo = vi.fn();
            render(<QueryClientProvider client={new QueryClient()}>
                <MemoryRouter><CreationDetail creationIdOverride="example" userProfile={userProfile}
                    setModalMessage={vi.fn()} setConfirmation={vi.fn()} setExternalLink={vi.fn()} />
                </MemoryRouter>
            </QueryClientProvider>);
            expect(await screen.findByRole('heading', { name: 'Example park' })).toBeInTheDocument();
            expect(screen.getByText('A park description')).toBeInTheDocument();
            expect(screen.queryByText(/direct install/i)).not.toBeInTheDocument();
        },
    );
});
