import React, { useEffect, useState } from 'react';
import { acceleratorFromKeyboardEvent, displayAccelerator } from '../../utils/keyboardShortcut';
import { getCachedFrontierDlcCatalogs } from '../../utils/frontierDlcCatalogCache';
import ClientUpdateSettings from './ClientUpdateSettings';

const cardClass = 'pc-theme-card bg-white p-6 rounded-lg shadow-md space-y-4';
const buttonClass = 'rounded-lg bg-gray-800 px-4 py-2 text-sm font-bold text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed';

function SettingToggle({ title, description, checked, disabled, onChange }) {
    return <label className="flex items-start justify-between gap-6">
        <span><span className="block font-semibold text-gray-800">{title}</span>
            <span className="mt-1 block text-sm text-gray-600">{description}</span></span>
        <input type="checkbox" aria-label={title} checked={checked} disabled={disabled} onChange={onChange}
            className="mt-1 h-5 w-5 shrink-0 accent-blue-600 disabled:opacity-50" />
    </label>;
}

// Device preferences use the native bridge only, including in the offline manager.
export default function ClientSettings({ setModalMessage }) {
    const api = window.electronAPI;
    const supported = api?.isElectron === true;
    const [path, setPath] = useState(null);
    const [startup, setStartup] = useState(null);
    const [autoEnabled, setAutoEnabled] = useState(null);
    const [forcedVisible, setForcedVisible] = useState(null);
    const [hotkeys, setHotkeys] = useState(null);
    const [draft, setDraft] = useState(null);
    const [busy, setBusy] = useState('');
    const [errors, setErrors] = useState({});
    const [loadAttempt, setLoadAttempt] = useState(0);
    const supportsAuto = Boolean(api?.getOverlayAutoEnabled && api?.setOverlayAutoEnabled);

    useEffect(() => {
        if (!supported) return undefined;
        let cancelled = false;
        const load = async (key, getter, setter) => {
            if (!getter) return;
            try {
                const result = await getter();
                if (!cancelled) setter(result);
            } catch (error) {
                if (!cancelled) setErrors(current => ({ ...current, [key]: `Could not load ${key}: ${error.message}` }));
            }
        };
        setErrors({});
        load('game folder', api.getStoredPath, setPath);
        load('startup settings', api.getLaunchAtLogin, setStartup);
        load('automatic overlay', api.getOverlayAutoEnabled, setAutoEnabled);
        load('overlay visibility', api.getOverlayForced, setForcedVisible);
        load('keyboard shortcuts', api.getOverlayHotkeys, setHotkeys);
        const unsubscribers = [
            api.onOverlayAutoEnabledChanged?.(setAutoEnabled),
            api.onOverlayForcedChanged?.(setForcedVisible),
            api.onOverlayHotkeysChanged?.(setHotkeys),
        ];
        return () => {
            cancelled = true;
            unsubscribers.forEach(unsubscribe => unsubscribe?.());
        };
    }, [api, supported, loadAttempt]);

    if (!supported) return null;

    const run = async (name, action) => {
        if (busy) return;
        setBusy(name);
        try { await action(); }
        catch (error) { setModalMessage(`Could not ${name}: ${error.message}`); }
        finally { setBusy(''); }
    };
    const changeFolder = () => run('change the game folder', async () => {
        const selected = await (api.selectFrontierFolder || api.selectFolder)();
        if (selected) setPath(selected);
    });
    const refreshStats = () => run('refresh all stats', async () => {
        await api.scanGames(path, { forceMetadataRefresh: true, dlcCatalogs: getCachedFrontierDlcCatalogs() });
        setModalMessage('The game files have been indexed. Detailed statistics are refreshed in the background and appear in the Offline Manager as they become available.');
    });
    const importBackup = () => run('import the backup', async () => {
        const result = await api.loadExternalBackup();
        if (!result || result.status === 'canceled' || !result.message) return;
        if (result.status === 'invalid') {
            setModalMessage(`SIGNATURE INVALID: ${result.message}`);
            return;
        }
        if (result.status === 'unsigned' && !window.confirm('WARNING: This backup is not signed. It should only be used if you created it yourself or received it from a trusted source.\n\nDo you want to continue importing this backup?')) return;
        setModalMessage(result.message);
    });
    const importMedia = () => run('import the media backup', async () => {
        const result = await api.importMediaBackup();
        if (result?.message) setModalMessage(result.message);
    });
    const recordShortcut = (field, event) => {
        // Tab / Shift+Tab must continue to move keyboard focus out of the field.
        if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !event.altKey) return;
        event.preventDefault();
        const accelerator = acceleratorFromKeyboardEvent(event);
        if (accelerator) setDraft(current => ({ ...(current || hotkeys.shortcuts), [field]: accelerator }));
    };
    const saveShortcuts = () => run('activate the keyboard shortcuts', async () => {
        const result = await api.setOverlayHotkeys(draft);
        setHotkeys(result);
        setDraft(null);
        setModalMessage('Keyboard shortcuts saved and activated.');
    });
    const shortcuts = draft || hotkeys?.shortcuts;
    const duplicateShortcuts = shortcuts?.icon === shortcuts?.overlay;

    return <div className="space-y-6">
        <div>
            <h2 className="text-2xl font-bold text-gray-800">Client</h2>
            <p className="mt-1 text-gray-600">Settings for this device. Available in the desktop client, including without signing in.</p>
        </div>
        <ClientUpdateSettings />
        {Object.keys(errors).length > 0 && <div role="alert" className="rounded-lg bg-red-50 p-4 text-red-700">
            {Object.entries(errors).map(([key, error]) => <p key={key}>{error}</p>)}
            <button type="button" className="mt-2 underline" onClick={() => setLoadAttempt(value => value + 1)}>Retry loading settings</button>
        </div>}
        <section className={cardClass} aria-label="In-Game Overlay">
            <h3 className="text-xl font-bold text-gray-800">In-Game Overlay</h3>
            <SettingToggle title="Show overlay automatically" checked={autoEnabled === true}
                disabled={!supportsAuto || autoEnabled === null || Boolean(busy)}
                description="Show the overlay icon when a supported game is detected on Windows. Turn this off to use the full-overlay shortcut manually."
                onChange={event => { const enabled = event.target.checked; run('change automatic overlay mode', async () => setAutoEnabled(await api.setOverlayAutoEnabled(enabled))); }} />
            {!supportsAuto && <p className="text-sm text-amber-700">Update the desktop client to change automatic overlay mode. Microsoft Store updates may become available a few days later. Your current overlay behavior is unchanged.</p>}
            {api.getOverlayForced && <SettingToggle title="Keep In-Game Overlay visible" checked={forcedVisible === true}
                disabled={forcedVisible === null || !api.setOverlayForced || Boolean(busy)}
                description="Keep the icon available without a running game, including on macOS and Linux. This overrides automatic mode; the icon shortcut can still hide it."
                onChange={event => { const enabled = event.target.checked; run('change overlay visibility', async () => setForcedVisible(await api.setOverlayForced(enabled))); }} />}
            {hotkeys?.iconEnabled === false && <p className="text-sm text-amber-700">The overlay icon is hidden by its keyboard shortcut. Use that shortcut again to re-enable it.</p>}
        </section>

        <section className={cardClass} aria-label="Keyboard shortcuts">
            <h3 className="text-xl font-bold text-gray-800">Keyboard shortcuts</h3>
            <p className="text-sm text-gray-600">Click a field and press a combination with Ctrl, Cmd or Alt. These shortcuts work while the game is focused. Changes apply after saving.</p>
            {shortcuts ? <>
                <div className="grid gap-4 sm:grid-cols-2">
                    {[['icon', 'Toggle overlay icon'], ['overlay', 'Toggle full overlay']].map(([field, label]) => <label key={field}>
                        <span className="mb-1 block text-sm font-bold text-gray-600">{label}</span>
                        <input readOnly aria-label={label} value={displayAccelerator(shortcuts[field])}
                            disabled={Boolean(busy) || !api.setOverlayHotkeys} onKeyDown={event => recordShortcut(field, event)}
                            onFocus={event => event.target.select()} className="w-full rounded-lg border p-3 text-center font-mono text-sm text-gray-800" />
                    </label>)}
                </div>
                <p className="text-sm text-gray-600">The icon shortcut controls the icon in automatic or always-visible mode. The full-overlay shortcut also works when both modes are off.</p>
                {duplicateShortcuts && <p role="alert" className="text-sm text-red-700">Choose a different shortcut for each action.</p>}
                <div className="flex flex-wrap gap-3">
                    <button type="button" className={buttonClass} disabled={!draft || duplicateShortcuts || Boolean(busy) || !api.setOverlayHotkeys} onClick={saveShortcuts}>Save keyboard shortcuts</button>
                    {draft && <button type="button" className="text-sm font-semibold text-gray-600 underline" disabled={Boolean(busy)} onClick={() => setDraft(null)}>Discard changes</button>}
                </div>
            </> : <p className="text-sm text-gray-600">{api.getOverlayHotkeys ? 'Loading keyboard shortcuts…' : 'Update the desktop client to configure keyboard shortcuts.'}</p>}
        </section>

        {startup?.supported && <section className={cardClass} aria-label="Startup">
            <h3 className="text-xl font-bold text-gray-800">Startup</h3>
            {startup.managedBySystem ? <>
                <p className="text-sm text-gray-600">The Microsoft Store version uses Windows Startup Apps settings. Enable or disable startup there.</p>
                <button type="button" className={buttonClass} disabled={Boolean(busy) || !api.openStartupAppSettings}
                    onClick={() => run('open Windows startup settings', async () => {
                        if (!await api.openStartupAppSettings()) throw new Error('Windows startup settings could not be opened.');
                    })}>Open Windows settings</button>
            </> : <SettingToggle title="Start PlanetCreations with Windows" checked={startup.enabled === true}
                disabled={Boolean(busy) || !api.setLaunchAtLogin}
                description="Open PlanetCreations when you sign in to Windows. Closing the window keeps the client running in the system tray."
                onChange={event => { const enabled = event.target.checked; run('change Windows startup', async () => setStartup(await api.setLaunchAtLogin(enabled))); }} />}
        </section>}

        <section className={cardClass} aria-label="Local files and backups">
            <h3 className="text-xl font-bold text-gray-800">Local files & backups</h3>
            <div><p className="text-sm font-semibold text-gray-700">Game files folder</p>
                <p className="mt-1 break-all text-sm text-gray-600">{path || 'No folder selected'}</p></div>
            <div className="flex flex-wrap gap-3">
                <button type="button" className={buttonClass} disabled={Boolean(busy) || !(api.selectFrontierFolder || api.selectFolder)} onClick={changeFolder}>Change Game Files Path</button>
                <button type="button" className={buttonClass} disabled={Boolean(busy) || !path || !api.scanGames} onClick={refreshStats}>Refresh all stats</button>
                <button type="button" className={buttonClass} disabled={Boolean(busy) || !api.loadExternalBackup} onClick={importBackup}>Import Backup</button>
                <button type="button" className={buttonClass} disabled={Boolean(busy) || !api.importMediaBackup} onClick={importMedia}>Import Media Backup</button>
                <button type="button" className={buttonClass} disabled={Boolean(busy) || !api.openBackupFolder} onClick={() => run('open the backup folder', () => api.openBackupFolder())}>Open Backup Folder</button>
            </div>
            <p className="text-sm text-gray-600">Changed folders and imported files appear when you return to the Offline Manager. Refresh all stats re-analyzes local files; it can take time for large libraries.</p>
        </section>
        {busy && <p role="status" className="text-sm text-gray-600">Working…</p>}
    </div>;
}
