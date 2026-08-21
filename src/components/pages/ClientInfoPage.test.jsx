import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ClientInfoPage from './ClientInfoPage';

describe('ClientInfoPage download shortcuts', () => {
    beforeEach(() => {
        vi.stubGlobal('fetch', vi.fn(() => new Promise(() => {})));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it.each([
        'Download Latest Release',
        'Choose your download',
    ])('scrolls to the download section from %s', (buttonName) => {
        render(<ClientInfoPage />);
        const downloads = document.getElementById('client-downloads');
        downloads.scrollIntoView = vi.fn();

        fireEvent.click(screen.getByRole('button', { name: buttonName }));

        expect(downloads.scrollIntoView).toHaveBeenCalledWith({
            behavior: 'smooth',
            block: 'start',
        });
    });

    it.each([
        ['PlanetCreations', 'in-game-overlay-feature'],
        ['Savefile Stats', 'savefile-intelligence'],
        ['Backups', 'savegame-backups'],
        ['Custom Media', 'custom-media-automation'],
        ['In-Game Overlay', 'in-game-overlay-feature'],
        ['Savegame backed up', 'savegame-backups'],
    ])('opens the relevant section from the preview label %s', (buttonName, sectionId) => {
        render(<ClientInfoPage />);
        const target = document.getElementById(sectionId);
        target.scrollIntoView = vi.fn();

        fireEvent.click(screen.getByRole('button', { name: buttonName, exact: true }));

        expect(target.scrollIntoView).toHaveBeenCalledWith({
            behavior: 'smooth',
            block: 'start',
        });
    });

    it('documents automatic savefile metadata and Custom Media handling', () => {
        render(<ClientInfoPage />);

        expect(screen.getByRole('heading', { name: 'From savefile to useful Creation data' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Automatic Custom Media' })).toBeInTheDocument();
        expect(screen.getByRole('heading', { name: 'Attractions & Areas' })).toBeInTheDocument();
        expect(screen.queryByText('Custom media is selected manually')).not.toBeInTheDocument();
    });
});
