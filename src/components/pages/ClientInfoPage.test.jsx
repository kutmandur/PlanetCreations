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
});
