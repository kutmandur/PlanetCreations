import React, { useEffect, useState } from 'react';
import {
    readGeneralOverlayNotificationPrefs,
    setGeneralOverlayNotificationPrefs,
    subscribeGeneralOverlayNotificationPrefs,
} from '../../utils/streamSession';

const GeneralOverlayNotificationSettings = ({ compact = false }) => {
    const [prefs, setPrefs] = useState(() => readGeneralOverlayNotificationPrefs());
    const [minutes, setMinutes] = useState(30);

    useEffect(() => subscribeGeneralOverlayNotificationPrefs(setPrefs), []);

    const save = (patch) => setPrefs(setGeneralOverlayNotificationPrefs(patch));
    const muteForMinutes = () => save({
        enabled: true,
        permanentlyMuted: false,
        mutedForStreamSessionId: null,
        mutedUntil: Date.now() + Math.max(1, Math.min(1440, Number(minutes) || 30)) * 60 * 1000,
    });
    const isTimedMute = Number(prefs.mutedUntil || 0) > Date.now();

    return (
        <section className={compact ? 'px-4 py-3 border-t dark:border-gray-700' : 'rounded-xl border dark:border-gray-700 p-4'}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">Client overlay notifications</h3>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                        Bell notifications still remain in your inbox. These controls only affect popovers below the In-Game Overlay icon.
                    </p>
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
                    <input
                        type="checkbox"
                        checked={prefs.enabled !== false}
                        onChange={(event) => save({ enabled: event.target.checked })}
                        className="h-4 w-4"
                    />
                    Show
                </label>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                    type="number"
                    min="1"
                    max="1440"
                    value={minutes}
                    onChange={(event) => setMinutes(event.target.value)}
                    className="w-20 rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm"
                    aria-label="Mute duration in minutes"
                />
                <button type="button" onClick={muteForMinutes} className="rounded-lg bg-gray-200 dark:bg-gray-700 px-3 py-1.5 text-xs font-semibold">
                    Mute minutes
                </button>
                <button
                    type="button"
                        onClick={() => save({ enabled: true, permanentlyMuted: true, mutedUntil: 0, mutedForStreamSessionId: null })}
                    className="rounded-lg bg-gray-200 dark:bg-gray-700 px-3 py-1.5 text-xs font-semibold"
                >
                    Mute until enabled
                </button>
                {(prefs.permanentlyMuted || prefs.mutedForStreamSessionId || isTimedMute || prefs.enabled === false) && (
                    <button
                        type="button"
                        onClick={() => save({ enabled: true, permanentlyMuted: false, mutedUntil: 0, mutedForStreamSessionId: null })}
                        className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                        Unmute
                    </button>
                )}
            </div>
        </section>
    );
};

export default GeneralOverlayNotificationSettings;
