import React, { useEffect, useState } from 'react';
import { setGeneralOverlayNotificationPrefs } from '../../utils/streamSession';

const OverlayNotificationPopover = () => {
    const [notification, setNotification] = useState(null);
    const [showMute, setShowMute] = useState(false);
    const [minutes, setMinutes] = useState(30);

    useEffect(() => {
        let cancelled = false;
        window.electronAPI?.getOverlayNotificationContext?.().then((value) => {
            if (!cancelled) setNotification(value || null);
        }).catch(() => {});
        const unsubscribe = window.electronAPI?.onOverlayNotificationChanged?.((value) => {
            setNotification(value || null);
            setShowMute(false);
        });
        return () => {
            cancelled = true;
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, []);

    const mute = (patch) => {
        setGeneralOverlayNotificationPrefs({ enabled: true, mutedUntil: 0, permanentlyMuted: false, mutedForStreamSessionId: null, ...patch });
        window.electronAPI?.closeOverlayNotification?.();
    };

    if (!notification) return <div className="h-screen bg-transparent" />;
    return (
        <div className="h-screen bg-transparent p-2">
            <article className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white/95 dark:bg-gray-900/95 p-4 shadow-2xl backdrop-blur text-gray-900 dark:text-gray-100">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <p className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400">Notification</p>
                        <h1 className="mt-1 font-bold leading-tight">{notification.title || 'PlanetCreations'}</h1>
                    </div>
                    <button type="button" onClick={() => window.electronAPI?.closeOverlayNotification?.()} className="rounded-full bg-gray-100 dark:bg-gray-800 w-7 h-7 text-sm" aria-label="Dismiss">×</button>
                </div>
                {notification.message && <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{notification.message}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" onClick={() => window.electronAPI?.openOverlayNotificationLink?.(notification.link || '/')} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">Open</button>
                    <button type="button" onClick={() => setShowMute((value) => !value)} className="rounded-lg bg-gray-200 dark:bg-gray-700 px-3 py-1.5 text-xs font-semibold">Mute…</button>
                </div>
                {showMute && (
                    <div className="mt-3 border-t dark:border-gray-700 pt-3 flex flex-wrap items-center gap-2">
                        <input type="number" min="1" max="1440" value={minutes} onChange={(event) => setMinutes(event.target.value)} className="w-16 rounded border dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1 text-xs" aria-label="Minutes" />
                        <button type="button" onClick={() => mute({ mutedUntil: Date.now() + Math.max(1, Math.min(1440, Number(minutes) || 30)) * 60 * 1000 })} className="rounded bg-gray-200 dark:bg-gray-700 px-2 py-1 text-xs">Minutes</button>
                        <button type="button" onClick={() => mute({ permanentlyMuted: true })} className="rounded bg-gray-200 dark:bg-gray-700 px-2 py-1 text-xs">Until enabled</button>
                    </div>
                )}
            </article>
        </div>
    );
};

export default OverlayNotificationPopover;
