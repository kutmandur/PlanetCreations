import React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { onSnapshot, getDoc } from 'firebase/firestore';
import SettingsPage from './SettingsPage';
import { getActivePersonalTheme, setPersonalThemeUser } from '../../utils/personalTheme';

vi.mock('../../firebase/config', () => ({ db: {}, auth: { currentUser: null } }));
vi.mock('../../firebase/community', () => ({ joinCommunity: vi.fn() }));
vi.mock('../../firebase/discord', () => ({ openDiscordLink: vi.fn(), unlinkDiscordAccount: vi.fn() }));
vi.mock('firebase/firestore', () => ({
    doc: vi.fn(), getDoc: vi.fn(), updateDoc: vi.fn(), collection: vi.fn(), getDocs: vi.fn(), query: vi.fn(), where: vi.fn(),
    onSnapshot: vi.fn(() => vi.fn()),
}));
vi.mock('../ui/NotificationSettings', () => ({ default: () => <div>Notification preferences</div> }));
vi.mock('../ui/PersonalizationSettings', () => ({ default: () => <div>Feed preferences</div> }));
vi.mock('../modals/InfluencerApplicationModal', () => ({ default: () => null }));

const user = { uid: 'test', emailVerified: true };
beforeEach(() => { vi.clearAllMocks(); localStorage.clear(); setPersonalThemeUser(null); delete window.electronAPI; });
afterEach(() => { cleanup(); setPersonalThemeUser(null); delete window.electronAPI; });

it('keeps client-only preferences out of normal browser settings', () => {
    render(<SettingsPage user={user} setModalMessage={vi.fn()} />);
    expect(screen.getByRole('heading', { name: 'Change Password' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Client/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Show overlay automatically' })).not.toBeInTheDocument();
});
it('opens the local client section without a login or Firestore reads', async () => {
    window.electronAPI = { isElectron: true, getStoredPath: vi.fn().mockResolvedValue('C:\\Frontier') };
    // Even an available account must not start account subscriptions in offline settings.
    render(<SettingsPage user={user} clientOnly setModalMessage={vi.fn()} />);
    await screen.findByText('C:\\Frontier');
    expect(screen.queryByRole('heading', { name: 'Change Password' })).not.toBeInTheDocument();
    expect(screen.queryByText('Notification preferences')).not.toBeInTheDocument();
    expect(screen.queryByText('Feed preferences')).not.toBeInTheDocument();
    expect(onSnapshot).not.toHaveBeenCalled();
    expect(getDoc).not.toHaveBeenCalled();
});
it('integrates the client section into normal settings without needing the OBS bridge', async () => {
    window.electronAPI = { isElectron: true, getStoredPath: vi.fn().mockResolvedValue('D:\\Frontier') };
    render(<SettingsPage user={user} setModalMessage={vi.fn()} />);
    expect(window.electronAPI.getStoredPath).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Client.*Overlay, shortcuts/ }));
    await screen.findByText('D:\\Frontier');
    expect(screen.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
});
it('opens the same local controls when signed out and can return to the library', async () => {
    window.electronAPI = { isElectron: true, getStoredPath: vi.fn().mockResolvedValue(null) };
    const back = vi.fn();
    render(<SettingsPage clientOnly setModalMessage={vi.fn()} onBackToLibrary={back} />);
    await screen.findByText('No folder selected');
    fireEvent.click(screen.getByRole('button', { name: /Back to Offline Manager/ }));
    expect(back).toHaveBeenCalledTimes(1);
    expect(onSnapshot).not.toHaveBeenCalled();
});
it('offers Themes under Personalization in a normal browser', () => {
    render(<SettingsPage user={user} setModalMessage={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /Personalization/ }));
    expect(screen.getByRole('heading', { name: 'Themes' })).toBeVisible();
    expect(screen.getByLabelText('Background image')).toBeVisible();
    expect(screen.queryByRole('button', { name: /Streaming.*OBS/ })).not.toBeInTheDocument();
});
it('hydrates only confirmed themes without extra profile reads for theme-only updates', async () => {
    setPersonalThemeUser(user.uid);
    getDoc.mockResolvedValue({ exists: () => true, data: () => ({ username: 'Test' }) });
    render(<SettingsPage user={user} setModalMessage={vi.fn()} />);
    const snapshot = onSnapshot.mock.calls[0][1];
    const emit = async (color, pending = false) => act(async () => {
        await snapshot({ exists: () => true, metadata: { hasPendingWrites: pending }, data: () => ({ role: 'user', personalTheme: { cardColor: color } }) });
    });
    await emit('#123456');
    await emit('#abcdef', true);
    expect(getActivePersonalTheme().cardColor).toBe('#123456');
    await emit('#abcdef');
    expect(getActivePersonalTheme().cardColor).toBe('#abcdef');
    expect(getDoc).toHaveBeenCalledTimes(1);
    expect(onSnapshot).toHaveBeenCalledTimes(1);
});
