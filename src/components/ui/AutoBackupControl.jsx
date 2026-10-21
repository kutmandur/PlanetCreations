import React, { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

const containsNode = (element, target) => target instanceof Node && Boolean(element?.contains(target));

export function useAutoBackupSettings(active) {
    const [settings, setSettings] = useState(null);
    const [error, setError] = useState('');
    const supported = Boolean(window.electronAPI?.getAutoBackupSettings && window.electronAPI?.setAutoBackupEnabled);
    useEffect(() => {
        if (!active || !supported) return undefined;
        let mounted = true;
        let receivedUpdate = false;
        const unsubscribe = window.electronAPI.onAutoBackupSettingsChanged?.(next => {
            receivedUpdate = true;
            if (mounted) setSettings(next);
        });
        window.electronAPI.getAutoBackupSettings().then(next => {
            if (mounted && !receivedUpdate) setSettings(next);
        }).catch(reason => { if (mounted) setError(reason.message); });
        return () => { mounted = false; unsubscribe?.(); };
    }, [active, supported]);
    return { settings, error, supported, setSettings };
}

export default function AutoBackupControl({ file, state }) {
    const [busy, setBusy] = useState(false);
    const [showHint, setShowHint] = useState(false);
    const [error, setError] = useState('');
    const descriptionId = useId();
    const anchorRef = useRef(null);
    const triggerRef = useRef(null);
    const hintRef = useRef(null);
    const [position, setPosition] = useState({ left: 0, top: 0, width: 320, maxHeight: 400 });
    const portalHost = document.querySelector('.overlay-surface-content') || document.body;
    useLayoutEffect(() => {
        if (!showHint) return undefined;
        const update = () => {
            if (!anchorRef.current || !hintRef.current) return;
            const anchor = anchorRef.current.getBoundingClientRect();
            const area = portalHost === document.body
                ? { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
                : portalHost.getBoundingClientRect();
            const width = Math.min(320, Math.max(0, area.width - 16));
            const maxHeight = Math.max(0, area.height - 16);
            hintRef.current.style.width = `${width}px`;
            hintRef.current.style.maxHeight = `${maxHeight}px`;
            const height = hintRef.current.getBoundingClientRect().height;
            const above = anchor.top - area.top - height - 8;
            setPosition({
                left: Math.max(8, Math.min(anchor.right - area.left - width, area.width - width - 8)),
                top: Math.max(8, Math.min(above >= 8 ? above : anchor.bottom - area.top + 8, area.height - height - 8)),
                width, maxHeight,
            });
        };
        update();
        window.addEventListener('scroll', update, true);
        window.addEventListener('resize', update);
        const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
        observer?.observe(hintRef.current);
        return () => {
            window.removeEventListener('scroll', update, true);
            window.removeEventListener('resize', update);
            observer?.disconnect();
        };
    }, [showHint, portalHost]);
    const entry = state.settings?.[file.path];
    const enabled = entry?.enabled === true;
    const change = async () => {
        setBusy(true);
        setError('');
        try { state.setSettings(await window.electronAPI.setAutoBackupEnabled(file.path, !enabled)); }
        catch (reason) { setError(reason.message || 'Could not change automatic backups.'); }
        finally { setBusy(false); }
    };
    return <div className="mt-3 rounded-lg bg-gray-800 p-2 text-sm">
        <div ref={triggerRef} className="relative flex items-center gap-2"
            onMouseEnter={() => setShowHint(true)}
            onMouseLeave={event => { if (!event.currentTarget.contains(document.activeElement) && !containsNode(hintRef.current, event.relatedTarget)) setShowHint(false); }}
            onFocus={() => setShowHint(true)}
            onBlur={event => { if (!containsNode(event.currentTarget, event.relatedTarget)) setShowHint(false); }}
            onKeyDown={event => { if (event.key === 'Escape') setShowHint(false); }}>
            <label className="flex flex-1 items-center justify-between gap-2 text-white">
                Auto backup on save
                <input type="checkbox" aria-label={`Auto backup on save for ${file.name}`} aria-describedby={descriptionId}
                    checked={enabled} disabled={busy || !state.supported || !state.settings} onChange={change} />
            </label>
            <button ref={anchorRef} type="button" aria-label={`About automatic backups for ${file.name}`} aria-describedby={descriptionId}
                onClick={() => setShowHint(true)}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-gray-400 text-xs text-gray-300">i</button>
            {createPortal(<div ref={hintRef} id={descriptionId} role="tooltip" hidden={!showHint}
                style={position}
                onMouseEnter={() => setShowHint(true)}
                onMouseLeave={event => {
                    if (!containsNode(triggerRef.current, event.relatedTarget) && !triggerRef.current?.contains(document.activeElement)) setShowHint(false);
                }}
                className="fixed z-[20000] overflow-y-auto rounded-lg border border-gray-600 bg-gray-900 p-3 text-xs leading-relaxed text-white shadow-xl">
                <p>Only for important files: many park versions can use a lot of disk space. Old backups are kept until you delete them.</p>
                <p className="mt-2">Runs while the client is open, including in the tray. An in-progress backup may finish after switching off.</p>
            </div>, portalHost)}
        </div>
        {!state.supported && <p className="mt-1 text-xs text-gray-400">Update the desktop client to enable automatic backups.</p>}
        {enabled && entry.lastBackupAt && <p className="mt-1 text-xs text-gray-400">Last auto backup: {new Date(entry.lastBackupAt).toLocaleString()}</p>}
        {(error || state.error || entry?.error) && <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-400">{error || state.error || entry.error}</p>}
    </div>;
}
