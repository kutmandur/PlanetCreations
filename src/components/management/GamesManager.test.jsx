import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import GamesManager from './GamesManager';

const games = [
    {
        id: 'planet-coaster-2',
        name: 'Planet Coaster 2',
        shortName: 'PC2',
        color: '#3B82F6',
        platforms: ['pc', 'console'],
        modsSupported: true,
        fileExtensions: ['.park2', '.blpr2'],
        enabled: true,
        order: 0,
    },
    {
        id: 'planet-zoo',
        name: 'Planet Zoo',
        shortName: 'PZ',
        color: '#16A34A',
        platforms: ['pc'],
        modsSupported: false,
        fileExtensions: ['.zoo'],
        enabled: true,
        order: 1,
    },
];

vi.mock('firebase/firestore', () => ({
    collection: vi.fn(() => ({})),
    deleteDoc: vi.fn(),
    doc: vi.fn(() => ({})),
    getCountFromServer: vi.fn(async () => ({ data: () => ({ count: 0 }) })),
    query: vi.fn(value => value),
    setDoc: vi.fn(),
    where: vi.fn(),
}));

vi.mock('../../firebase/config', () => ({ db: {} }));
vi.mock('../../hooks/useGames', () => ({ default: () => games }));
vi.mock('../../utils/gamesRegistry', () => ({
    getDefaultGameId: () => 'planet-coaster-2',
    saveGamesRegistry: vi.fn(async () => {}),
}));

describe('GamesManager consolidated game settings', () => {
    test('shows the settings for the selected game and edits them in a popover', async () => {
        render(
            <GamesManager
                setModalMessage={vi.fn()}
                selectedGameId="planet-zoo"
                onSelectedGameChange={vi.fn()}
                onAddGameOpenChange={vi.fn()}
            />,
        );

        expect(screen.getByRole('heading', { name: 'Game Settings' })).toBeInTheDocument();
        expect(screen.getByText('planet-zoo')).toBeInTheDocument();
        expect(screen.getByText('.zoo')).toBeInTheDocument();
        expect(screen.getByText('Mods: not supported')).toBeInTheDocument();
        expect(await screen.findByText('0 creations')).toBeInTheDocument();

        fireEvent.click(screen.getByRole('button', { name: 'Edit settings' }));
        expect(screen.getByRole('heading', { name: 'Edit Planet Zoo' })).toBeInTheDocument();
        expect(screen.getByDisplayValue('Planet Zoo')).toBeInTheDocument();
    });

    test('opens the add-game popover when requested by the selector action', async () => {
        const onAddGameOpenChange = vi.fn();
        const { rerender } = render(
            <GamesManager
                setModalMessage={vi.fn()}
                selectedGameId="planet-coaster-2"
                onSelectedGameChange={vi.fn()}
                addGameOpen={false}
                onAddGameOpenChange={onAddGameOpenChange}
            />,
        );
        expect(await screen.findByText('0 creations')).toBeInTheDocument();

        rerender(
            <GamesManager
                setModalMessage={vi.fn()}
                selectedGameId="planet-coaster-2"
                onSelectedGameChange={vi.fn()}
                addGameOpen
                onAddGameOpenChange={onAddGameOpenChange}
            />,
        );

        expect(await screen.findByRole('heading', { name: 'Add Game' })).toBeInTheDocument();
        expect(screen.getByLabelText('Id (slug, permanent)')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
        expect(onAddGameOpenChange).toHaveBeenCalledWith(false);
    });
});
