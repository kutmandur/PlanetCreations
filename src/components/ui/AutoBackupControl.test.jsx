import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import AutoBackupControl, { useAutoBackupSettings } from './AutoBackupControl';

const file = { path: '/Frontier/Saves/park.zoo', name: 'park.zoo' };
const state = (settings = {}) => ({ settings, supported: true, error: '', setSettings: vi.fn() });
afterEach(() => { delete window.electronAPI; vi.restoreAllMocks(); });

test('shows the hint on hover and keyboard focus, and Escape dismisses it', () => {
    render(<AutoBackupControl file={file} state={state()} />);
    const hint = screen.getByRole('tooltip', { hidden: true });
    expect(hint).not.toBeVisible();
    expect(hint.parentElement).toBe(document.body);
    const help = screen.getByRole('button', { name: /About automatic backups/ });
    fireEvent.mouseEnter(help);
    expect(hint).toBeVisible();
    expect(hint).toHaveTextContent('Only for important files');
    fireEvent.mouseLeave(help);
    expect(hint).not.toBeVisible();
    fireEvent.focus(help);
    expect(hint).toBeVisible();
    fireEvent.keyDown(help, { key: 'Escape' });
    expect(hint).not.toBeVisible();
});

test('enables only the selected file directly without a confirmation dialog', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    const next = { [file.path]: { enabled: true } };
    window.electronAPI = { setAutoBackupEnabled: vi.fn().mockResolvedValue(next) };
    const current = state();
    render(<AutoBackupControl file={file} state={current} />);
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(current.setSettings).toHaveBeenCalledWith(next));
    expect(window.electronAPI.setAutoBackupEnabled).toHaveBeenCalledWith(file.path, true);
    expect(confirm).not.toHaveBeenCalled();
});

test('disabling requires no warning confirmation and errors preserve enabled status', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    window.electronAPI = { setAutoBackupEnabled: vi.fn().mockRejectedValue(new Error('Cannot save settings')) };
    render(<AutoBackupControl file={file} state={state({ [file.path]: { enabled: true } })} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Cannot save settings');
    expect(screen.getByRole('checkbox')).toBeChecked();
    expect(confirm).not.toHaveBeenCalled();
    expect(window.electronAPI.setAutoBackupEnabled).toHaveBeenCalledWith(file.path, false);
});

test('older bridges show an update hint instead of a nonfunctional switch', () => {
    render(<AutoBackupControl file={file} state={{ ...state(), supported: false }} />);
    expect(screen.getByRole('checkbox')).toBeDisabled();
    expect(screen.getByText(/Update the desktop client/)).toBeVisible();
});

test('loads saved per-file settings and unsubscribes on unmount', async () => {
    const unsubscribe = vi.fn();
    window.electronAPI = {
        getAutoBackupSettings: vi.fn().mockResolvedValue({ [file.path]: { enabled: true, error: 'Disk full' } }),
        setAutoBackupEnabled: vi.fn(), onAutoBackupSettingsChanged: vi.fn().mockReturnValue(unsubscribe),
    };
    function Harness() { return <AutoBackupControl file={file} state={useAutoBackupSettings(true)} />; }
    const { unmount } = render(<Harness />);
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeChecked());
    expect(screen.getByRole('alert')).toHaveTextContent('Disk full');
    unmount(); expect(unsubscribe).toHaveBeenCalled();
});
