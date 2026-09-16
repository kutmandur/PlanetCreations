import React, { useEffect, useRef, useState } from 'react';

const buttonClass = 'rounded-lg bg-gray-800 px-4 py-2 text-sm font-bold text-white hover:bg-gray-700 disabled:opacity-50 disabled:cursor-not-allowed';

export default function ClientUpdateSettings() {
    const api = window.electronAPI;
    const [status, setStatus] = useState(null);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState('');
    const [loadAttempt, setLoadAttempt] = useState(0);
    const eventRevision = useRef(0);
    const mounted = useRef(false);
    const isStore = api?.isStoreBuild === true || api?.distributionChannel === 'store'
        || api?.updatesManagedBy === 'microsoft-store' || status?.status === 'store';
    // The Store receives this card with its next native release, independently
    // of the hosted UI deployment for clients with the built-in updater.
    const deferredStore = isStore && !api?.getClientUpdateStatus;

    useEffect(() => {
        if (!api?.isElectron || deferredStore) return undefined;
        mounted.current = true;
        let cancelled = false;
        const revision = eventRevision.current;
        const unsubscribe = !isStore && api.onClientUpdateStatusChanged?.(next => {
            if (cancelled) return;
            eventRevision.current += 1;
            setStatus(next);
            setError('');
        });
        setError('');
        const load = async () => {
            try {
                // Released clients retain their existing identity contract. A
                // hosted UI update must not require a newer native bridge.
                const next = api.getClientUpdateStatus
                    ? await api.getClientUpdateStatus()
                    : { version: (await api.getClientIdentity?.())?.clientVersion, status: 'legacy' };
                if (!cancelled && revision === eventRevision.current) setStatus(next);
            } catch (loadError) {
                if (!cancelled && revision === eventRevision.current) setError('Could not load the client version and update status.');
            }
        };
        load();
        return () => {
            cancelled = true;
            mounted.current = false;
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, [api, isStore, deferredStore, loadAttempt]);

    if (!api?.isElectron || deferredStore) return null;

    const check = async () => {
        if (pending || !api.checkForUpdates || isStore) return;
        setPending(true);
        setError('');
        const revision = eventRevision.current;
        try {
            const next = await api.checkForUpdates();
            if (mounted.current && revision === eventRevision.current) setStatus(next);
        } catch (checkError) {
            if (mounted.current) setError('Could not check for updates. Please try again.');
        } finally {
            if (mounted.current) setPending(false);
        }
    };
    const checking = pending || status?.status === 'checking';
    const busy = checking || ['downloading', 'downloaded', 'disabled'].includes(status?.status);
    const checkedDate = typeof status?.lastCheckedAt === 'string' ? new Date(status.lastCheckedAt) : null;
    const lastChecked = checkedDate && Number.isFinite(checkedDate.getTime())
        ? checkedDate.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
        : 'Not checked yet';
    const message = {
        checking: 'Checking for updates…',
        current: 'Your client is up to date.',
        downloading: `Downloading version ${status?.availableVersion || ''}…`,
        downloaded: `Version ${status?.availableVersion || ''} is ready. Restart the client to install it.`,
        available: `Version ${status?.availableVersion || ''} is available to download.`,
        disabled: 'Update checks are available in installed client builds.',
        error: 'Could not check for or download updates. Check your connection and try again.',
        legacy: 'Install a newer client to enable manual update checks here.',
    }[status?.status];

    return <section className="pc-theme-card bg-white p-6 rounded-lg shadow-md space-y-4" aria-label="Client updates">
        <h3 className="text-xl font-bold text-gray-800">{isStore ? 'Client version' : 'Client updates'}</h3>
        {!isStore && <button type="button" className={buttonClass}
            disabled={!status || !api.checkForUpdates || busy} onClick={check}>
            {checking ? 'Checking for updates…' : 'Check for updates'}
        </button>}
        <div className="space-y-1 text-sm text-gray-600">
            <p>Version: <span className="font-semibold text-gray-800">{status?.version || (error || status ? 'Unavailable' : 'Loading…')}</span></p>
            {!isStore && <p>Last checked: {lastChecked}</p>}
        </div>
        {!isStore && <>
            {error ? <p role="alert" className="text-sm text-red-700">{error}</p>
                : message && <p role={status.status === 'error' ? 'alert' : 'status'} className={`text-sm ${status.status === 'error' ? 'text-red-700' : 'text-gray-600'}`}>{message}</p>}
            {error && !status && <button type="button" className="text-sm underline" onClick={() => setLoadAttempt(value => value + 1)}>Retry loading update status</button>}
            {status?.status === 'downloaded' && api.restartApp && <button type="button" className={buttonClass} onClick={() => api.restartApp()}>Restart to install</button>}
            {status?.status === 'available' && status.downloadUrl && api.openExternalLink && <button type="button" className={buttonClass}
                onClick={async () => {
                    try { await api.openExternalLink(status.downloadUrl); }
                    catch (openError) { if (mounted.current) setError('Could not open the download page. Please try again.'); }
                }}>Download update</button>}
        </>}
    </section>;
}
