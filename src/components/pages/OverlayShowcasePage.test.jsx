import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    callable: vi.fn(),
    getDoc: vi.fn(),
}));

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn((...parts) => parts.at(-1)),
    getDoc: mocks.getDoc,
}));
vi.mock('firebase/functions', () => ({
    getFunctions: vi.fn(() => ({})),
    httpsCallable: vi.fn(() => mocks.callable),
}));
vi.mock('../ui/SharingQrCode', () => ({ default: ({ name }) => <div>QR for {name}</div> }));
vi.mock('../ui/VerifiedParkStats', () => ({
    default: () => <div>Blueprint details</div>,
    AreaSections: () => <div>Areas</div>,
    TypeSections: () => <div>Types</div>,
}));

import OverlayShowcasePage from './OverlayShowcasePage';

beforeEach(() => {
    localStorage.clear();
    mocks.callable.mockReset().mockResolvedValue({ data: { success: true } });
    mocks.getDoc.mockReset().mockResolvedValue({
        exists: () => true,
        id: 'creation-1',
        data: () => ({
            title: 'Showcase Blueprint',
            username: 'Creator',
            verifiedGameMetadata: { metadata: { blueprint: { rideCount: 1 } } },
        }),
    });
    window.electronAPI = { setOverlayExpanded: vi.fn() };
});

afterEach(() => {
    delete window.electronAPI;
    vi.restoreAllMocks();
});

test('finishes a remotely activated showcase on the desktop client', async () => {
    localStorage.setItem('pc.overlayQr', JSON.stringify({
        kind: 'community-showcase',
        communityId: 'community-1',
        showcaseTitle: 'Community picks',
        creationIds: ['creation-1'],
        activeCreationId: 'creation-1',
        creationId: 'creation-1',
        title: 'Showcase Blueprint',
        url: 'https://www.planetcreations.net/share/creation/creation-1',
        source: 'remote',
        enabledAt: 123,
    }));
    localStorage.setItem('pc.overlayShowcaseChecklist', JSON.stringify({
        signature: 'community-1\u001f\u001fcreation-1',
        checkedByCreation: { 'creation-1': ['ride-1'] },
    }));

    render(
        <MemoryRouter initialEntries={['/overlay/showcase']}>
            <OverlayShowcasePage localClientId="client-1" />
        </MemoryRouter>
    );

    expect(await screen.findByText('Showcase Blueprint')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish showcase' }));

    await waitFor(() => expect(mocks.callable).toHaveBeenCalledWith({
        clientId: 'client-1',
        entry: null,
    }));
    await waitFor(() => expect(localStorage.getItem('pc.overlayQr')).toBeNull());
    expect(localStorage.getItem('pc.overlayShowcaseChecklist')).toBeNull();
    expect(window.electronAPI.setOverlayExpanded).toHaveBeenCalledWith(false);
});
