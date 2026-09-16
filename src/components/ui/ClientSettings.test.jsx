import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ClientSettings from './ClientSettings';

const shortcuts = { icon: 'CommandOrControl+Alt+Shift+O', overlay: 'CommandOrControl+Alt+Shift+P' };
let api, message, listeners, unsubscribe;
beforeEach(() => {
    message = vi.fn(); listeners = {}; unsubscribe = vi.fn();
    api = window.electronAPI = {
        isElectron: true,
        getStoredPath: vi.fn().mockResolvedValue('C:\\Frontier'),
        getOverlayAutoEnabled: vi.fn().mockResolvedValue(true),
        setOverlayAutoEnabled: vi.fn(async value => value),
        getOverlayForced: vi.fn().mockResolvedValue(false),
        setOverlayForced: vi.fn(async value => value),
        getOverlayHotkeys: vi.fn().mockResolvedValue({ shortcuts, iconEnabled: true }),
        setOverlayHotkeys: vi.fn(async value => ({ shortcuts: value, iconEnabled: true })),
        onOverlayAutoEnabledChanged: vi.fn(callback => { listeners.auto = callback; return unsubscribe; }),
        onOverlayForcedChanged: vi.fn(callback => { listeners.forced = callback; return unsubscribe; }),
        onOverlayHotkeysChanged: vi.fn(callback => { listeners.hotkeys = callback; return unsubscribe; }),
        getLaunchAtLogin: vi.fn().mockResolvedValue({ supported: true, enabled: false }),
        setLaunchAtLogin: vi.fn(async enabled => ({ supported: true, enabled })),
        openStartupAppSettings: vi.fn().mockResolvedValue(true),
        selectFrontierFolder: vi.fn().mockResolvedValue('D:\\Frontier'),
        scanGames: vi.fn().mockResolvedValue({}),
        loadExternalBackup: vi.fn().mockResolvedValue({ status: 'valid', success: true, message: 'Backup imported.' }),
        importMediaBackup: vi.fn().mockResolvedValue({ success: true, message: 'Media imported.' }),
        openBackupFolder: vi.fn().mockResolvedValue(undefined),
    };
});
afterEach(() => { cleanup(); delete window.electronAPI; vi.restoreAllMocks(); });
async function open() {
    const view = render(<ClientSettings setModalMessage={message} />);
    await screen.findByDisplayValue('Ctrl/Cmd + Alt + Shift + O');
    return view;
}
it('does not expose or load native settings in a normal browser', () => {
    api.isElectron = false;
    const { container } = render(<ClientSettings setModalMessage={message} />);
    expect(container).toBeEmptyDOMElement();
    expect(api.getStoredPath).not.toHaveBeenCalled();
});
it('saves automatic mode once and reflects native changes without additional reads', async () => {
    const view = await open();
    const auto = screen.getByRole('checkbox', { name: 'Show overlay automatically' });
    expect(auto).toBeChecked();
    fireEvent.click(auto);
    await waitFor(() => expect(auto).not.toBeChecked());
    expect(api.setOverlayAutoEnabled).toHaveBeenCalledExactlyOnceWith(false);
    act(() => { listeners.auto(true); listeners.forced(true); });
    expect(auto).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Keep In-Game Overlay visible' })).toBeChecked();
    expect(api.getOverlayAutoEnabled).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(3);
});
it('keeps the saved state after a native write failure and allows retry', async () => {
    api.setOverlayAutoEnabled.mockRejectedValueOnce(new Error('Disk full'));
    await open();
    const auto = screen.getByRole('checkbox', { name: 'Show overlay automatically' });
    fireEvent.click(auto);
    await waitFor(() => expect(message).toHaveBeenCalledWith(expect.stringContaining('Disk full')));
    expect(auto).toBeChecked();
    expect(auto).toBeEnabled();
    fireEvent.click(auto);
    await waitFor(() => expect(auto).not.toBeChecked());
});
it('keeps legacy native features usable when automatic-mode IPC is absent', async () => {
    delete api.getOverlayAutoEnabled; delete api.setOverlayAutoEnabled;
    await open();
    expect(screen.getByRole('checkbox', { name: 'Show overlay automatically' })).toBeDisabled();
    expect(screen.getByText(/Update the desktop client to change automatic/)).toBeInTheDocument();
    expect(screen.getByText(/Microsoft Store updates may become available a few days later/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keep In-Game Overlay visible' }));
    await waitFor(() => expect(api.setOverlayForced).toHaveBeenCalledWith(true));
});
it('recovers a failed settings read without pretending the default is saved', async () => {
    api.getOverlayAutoEnabled.mockRejectedValueOnce(new Error('IPC failed'));
    await open();
    expect(screen.getByRole('checkbox', { name: 'Show overlay automatically' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading settings' }));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Show overlay automatically' })).toBeChecked());
});
it('saves shortcut drafts explicitly and preserves drafts when the icon is toggled', async () => {
    await open();
    fireEvent.keyDown(screen.getByLabelText('Toggle overlay icon'), { key: 'k', ctrlKey: true, shiftKey: true });
    expect(api.setOverlayHotkeys).not.toHaveBeenCalled();
    act(() => listeners.hotkeys({ shortcuts, iconEnabled: false }));
    expect(screen.getByLabelText('Toggle overlay icon')).toHaveValue('Ctrl/Cmd + Shift + K');
    fireEvent.click(screen.getByRole('button', { name: 'Save keyboard shortcuts' }));
    await waitFor(() => expect(api.setOverlayHotkeys).toHaveBeenCalledWith({ ...shortcuts, icon: 'CommandOrControl+Shift+K' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save keyboard shortcuts' })).toBeDisabled());
});
it('rejects duplicate shortcuts and reports native registration conflicts without losing the draft', async () => {
    await open();
    const input = screen.getByLabelText('Toggle overlay icon');
    fireEvent.keyDown(input, { key: 'p', ctrlKey: true, altKey: true, shiftKey: true });
    expect(screen.getByRole('button', { name: 'Save keyboard shortcuts' })).toBeDisabled();
    fireEvent.keyDown(input, { key: 'k', ctrlKey: true });
    api.setOverlayHotkeys.mockRejectedValueOnce(new Error('Already used by another application'));
    fireEvent.click(screen.getByRole('button', { name: 'Save keyboard shortcuts' }));
    await waitFor(() => expect(message).toHaveBeenCalledWith(expect.stringContaining('Already used')));
    expect(input).toHaveValue('Ctrl/Cmd + K');
    fireEvent.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(input).toHaveValue('Ctrl/Cmd + Alt + Shift + O');
});
it('lets Tab and Shift+Tab leave shortcut fields', async () => {
    await open();
    const input = screen.getByLabelText('Toggle overlay icon');
    expect(fireEvent.keyDown(input, { key: 'Tab' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })).toBe(true);
    expect(api.setOverlayHotkeys).not.toHaveBeenCalled();
});
it('preserves Store-managed startup through Windows settings', async () => {
    api.getLaunchAtLogin.mockResolvedValue({ supported: true, managedBySystem: true });
    await open();
    expect(screen.queryByRole('checkbox', { name: 'Start PlanetCreations with Windows' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Open Windows settings' }));
    await waitFor(() => expect(api.openStartupAppSettings).toHaveBeenCalledTimes(1));
    expect(api.setLaunchAtLogin).not.toHaveBeenCalled();
});
it('changes the local folder without scanning until explicitly requested', async () => {
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Change Game Files Path' }));
    await screen.findByText('D:\\Frontier');
    expect(api.scanGames).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh all stats' }));
    await waitFor(() => expect(api.scanGames).toHaveBeenCalledWith('D:\\Frontier', expect.objectContaining({ forceMetadataRefresh: true })));
});
it('retains backup and media import actions and signature errors', async () => {
    api.loadExternalBackup.mockResolvedValue({ status: 'invalid', message: 'Signature mismatch' });
    await open();
    fireEvent.click(screen.getByRole('button', { name: 'Import Backup' }));
    await waitFor(() => expect(message).toHaveBeenCalledWith('SIGNATURE INVALID: Signature mismatch'));
    fireEvent.click(screen.getByRole('button', { name: 'Import Media Backup' }));
    await waitFor(() => expect(message).toHaveBeenCalledWith('Media imported.'));
    fireEvent.click(screen.getByRole('button', { name: 'Open Backup Folder' }));
    await waitFor(() => expect(api.openBackupFolder).toHaveBeenCalledTimes(1));
});
