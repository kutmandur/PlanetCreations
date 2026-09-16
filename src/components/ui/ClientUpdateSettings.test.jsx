import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ClientUpdateSettings from './ClientUpdateSettings';

let api, listener, unsubscribe;
const idle = { version: '1.0.42', status: 'idle', lastCheckedAt: null };
beforeEach(() => {
    unsubscribe = vi.fn();
    listener = null;
    api = window.electronAPI = {
        isElectron: true,
        getClientUpdateStatus: vi.fn().mockResolvedValue(idle),
        checkForUpdates: vi.fn().mockResolvedValue({ ...idle, status: 'current', lastCheckedAt: '2026-09-16T12:34:56Z' }),
        onClientUpdateStatusChanged: vi.fn(callback => { listener = callback; return unsubscribe; }),
        restartApp: vi.fn(),
        openExternalLink: vi.fn().mockResolvedValue(undefined),
    };
});
afterEach(() => { cleanup(); delete window.electronAPI; });

async function open() {
    const view = render(<ClientUpdateSettings />);
    await screen.findByText('1.0.42');
    return view;
}

it('shows the native version and checks only on request, updating the displayed timestamp', async () => {
    const view = await open();
    expect(screen.getByText('Last checked: Not checked yet')).toBeInTheDocument();
    expect(api.checkForUpdates).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    await screen.findByText('Your client is up to date.');
    expect(api.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(screen.getByText(`Last checked: ${new Date('2026-09-16T12:34:56Z').toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}`)).toBeInTheDocument();
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
});

it('shows only the installed version in the Store, even if update APIs are present', async () => {
    api.isStoreBuild = true;
    api.getClientUpdateStatus.mockResolvedValue({ ...idle, status: 'store' });
    await open();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.queryByText(/Last checked/)).not.toBeInTheDocument();
    expect(api.checkForUpdates).not.toHaveBeenCalled();
    expect(api.onClientUpdateStatusChanged).not.toHaveBeenCalled();
});

it('does not expose client controls in the browser', () => {
    api.isElectron = false;
    expect(render(<ClientUpdateSettings />).container).toBeEmptyDOMElement();
    expect(api.getClientUpdateStatus).not.toHaveBeenCalled();
});

it('defers the Store version card until a Store build with the new native API is installed', () => {
    api.isStoreBuild = true;
    delete api.getClientUpdateStatus;
    api.getClientIdentity = vi.fn();
    expect(render(<ClientUpdateSettings />).container).toBeEmptyDOMElement();
    expect(api.getClientIdentity).not.toHaveBeenCalled();
    expect(api.checkForUpdates).not.toHaveBeenCalled();
    expect(api.onClientUpdateStatusChanged).not.toHaveBeenCalled();
});

it('keeps older clients usable and reads their version from the released bridge', async () => {
    delete api.getClientUpdateStatus;
    delete api.checkForUpdates;
    api.getClientIdentity = vi.fn().mockResolvedValue({ clientVersion: '1.0.42' });
    await open();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
    expect(screen.getByText(/Install a newer client/)).toBeInTheDocument();
});

it('does not overwrite a newer download event with an older initial snapshot', async () => {
    let finishLoading;
    api.getClientUpdateStatus.mockImplementation(() => new Promise(resolve => { finishLoading = resolve; }));
    render(<ClientUpdateSettings />);
    act(() => listener({ ...idle, status: 'downloaded', availableVersion: '1.0.43' }));
    await act(async () => finishLoading(idle));
    expect(screen.getByRole('button', { name: 'Restart to install' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Check for updates' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Restart to install' }));
    expect(api.restartApp).toHaveBeenCalledTimes(1);
});

it('disables repeat requests while checking and recovers from a failed IPC call', async () => {
    let fail;
    api.checkForUpdates.mockImplementationOnce(() => new Promise((resolve, reject) => { fail = reject; }));
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    expect(screen.getByRole('button', { name: 'Checking for updates…' })).toBeDisabled();
    await act(async () => fail(new Error('IPC disconnected')));
    expect(screen.getByRole('alert')).toHaveTextContent('Could not check for updates');
    fireEvent.click(screen.getByRole('button', { name: 'Check for updates' }));
    await screen.findByText('Your client is up to date.');
});

it('shows offline failures and manual download fallback without claiming to be current', async () => {
    await open();
    act(() => listener({ ...idle, status: 'error' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Check your connection');
    expect(screen.queryByText('Your client is up to date.')).not.toBeInTheDocument();
    const downloadUrl = 'https://github.com/kutmandur/PlanetCreations/releases/tag/v1.0.43';
    act(() => listener({ ...idle, status: 'available', availableVersion: '1.0.43', downloadUrl }));
    fireEvent.click(screen.getByRole('button', { name: 'Download update' }));
    await waitFor(() => expect(api.openExternalLink).toHaveBeenCalledWith(downloadUrl));
});

it('lets the user retry loading native state without initiating an update search', async () => {
    api.getClientUpdateStatus.mockRejectedValueOnce(new Error('IPC disconnected'));
    render(<ClientUpdateSettings />);
    fireEvent.click(await screen.findByRole('button', { name: 'Retry loading update status' }));
    await screen.findByText('1.0.42');
    expect(api.checkForUpdates).not.toHaveBeenCalled();
});
