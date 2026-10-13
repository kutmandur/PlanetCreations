import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import DiscordProfileLink from './DiscordProfileLink';
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it('copies CLWD-N9N3 username from the icon and confirms only after success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    render(<DiscordProfileLink value="clwd_n9n3" themeHex="#5865f2" />);
    const button = screen.getByRole('button', { name: 'Copy Discord username: clwd_n9n3' });
    expect(button.querySelector('svg')).not.toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText('Discord: clwd_n9n3')).toBeNull();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copied!'));
    expect(writeText).toHaveBeenCalledWith('clwd_n9n3');
});

it('retains direct profile navigation for a numeric ID', () => {
    render(<DiscordProfileLink value="123456789012345678" />);
    expect(screen.getByRole('link', { name: 'Discord' })).toHaveAttribute('href', 'https://discord.com/users/123456789012345678');
    expect(screen.queryByRole('button')).toBeNull();
});

it('shows failure instead of a false success when clipboard access is denied', async () => {
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error('Denied')) } });
    render(<DiscordProfileLink value="clwd_n9n3" />);
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Copy failed. Try again.'));
    expect(document.querySelector('textarea')).toBeNull();
});
