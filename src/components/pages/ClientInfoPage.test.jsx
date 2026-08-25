import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

    it('offers the Microsoft Store badge with the official product settings', () => {
        render(<ClientInfoPage />);

        const badge = document.querySelector('ms-store-badge');
        expect(badge).not.toBeNull();
        expect(badge).toHaveAttribute('productid', '9pc0mzv8rwr0');
        expect(badge).toHaveAttribute('productname', 'PlanetCreations Client');
        expect(badge).toHaveAttribute('window-mode', 'direct');
        expect(badge).toHaveAttribute('theme', 'auto');
        expect(badge).toHaveAttribute('size', 'large');
        expect(badge).toHaveAttribute('language', 'en-us');
        expect(badge).toHaveAttribute('animation', 'on');
    });

    it('explains the installation warning and Store certification timing', () => {
        render(<ClientInfoPage />);

        expect(screen.getByRole('button', { name: 'About Direct download' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'About the Microsoft Store version' })).toBeInTheDocument();
        expect(screen.getByText(/Windows SmartScreen may show an unknown-publisher warning/i)).toHaveAttribute('role', 'tooltip');
        expect(screen.getByText(/Updates arrive through Microsoft Store after certification/i)).toHaveAttribute('role', 'tooltip');
        expect(screen.queryByText(/removing the quarantine attribute/i)).not.toBeInTheDocument();
        expect(screen.getByText(/same PlanetCreations features/i)).toBeInTheDocument();
    });

    it('recommends the Apple Silicon download on an ARM Mac', async () => {
        vi.stubGlobal('navigator', {
            platform: 'MacIntel',
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
            userAgentData: {
                platform: 'macOS',
                getHighEntropyValues: vi.fn().mockResolvedValue({ architecture: 'arm', bitness: '64' }),
            },
        });

        render(<ClientInfoPage />);

        const appleSiliconCard = screen.getByText('Apple Silicon').closest('article');
        const intelCard = screen.getByText('Intel (x64)').closest('article');
        expect(await within(appleSiliconCard).findByText('Recommended for this device')).toBeInTheDocument();
        expect(within(intelCard).queryByText('Recommended for this device')).not.toBeInTheDocument();
    });

    it('switches the recommendation to the Intel download when Client Hints report x86', async () => {
        vi.stubGlobal('navigator', {
            platform: 'MacIntel',
            userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 13_0)',
            userAgentData: {
                platform: 'macOS',
                getHighEntropyValues: vi.fn().mockResolvedValue({ architecture: 'x86', bitness: '64' }),
            },
        });

        render(<ClientInfoPage />);

        const appleSiliconCard = screen.getByText('Apple Silicon').closest('article');
        const intelCard = screen.getByText('Intel (x64)').closest('article');
        await waitFor(() => {
            expect(within(intelCard).getByText('Recommended for this device')).toBeInTheDocument();
        });
        expect(within(appleSiliconCard).queryByText('Recommended for this device')).not.toBeInTheDocument();
    });
});
