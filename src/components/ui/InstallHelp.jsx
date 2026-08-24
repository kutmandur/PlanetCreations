import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon';
import { ICONS } from '../../utils/helpers';
import { enablePush, getPushPermission, isPushSupported } from '../../firebase/push';
import {
    canPromptInstall,
    promptInstall,
    onInstallAvailabilityChange,
    isStandalone,
    detectPlatform,
} from '../../utils/pwaInstall';

// Icon button beside the notification bell. Opens a dialog that lets the user
// enable browser notifications (the permission prompt) and/or install the web
// app — with per-platform guidance. Hidden in the Electron desktop client and
// when already running as an installed app (installed users are auto-prompted on
// first open and can re-enable from Settings).

const isElectron = typeof navigator !== 'undefined' && navigator.userAgent.toLowerCase().includes('electron');

const IOS_STEPS = [
    'Open this site in Safari.',
    'Tap the Share button (the square with an upward arrow).',
    'Choose “Add to Home Screen”.',
    'Open PlanetCreations from your home screen — you’ll be asked to allow notifications.',
];
const ANDROID_STEPS = [
    'Tap the ⋮ menu in Chrome.',
    'Choose “Install app” (or “Add to Home screen”).',
    'Open PlanetCreations from your home screen — you’ll be asked to allow notifications.',
];
const DESKTOP_STEPS = [
    'Click the install icon in your browser’s address bar (or the ⋮ menu → “Install PlanetCreations”).',
    'Or simply click “Enable notifications” above to get alerts in this browser without installing.',
];

const InstallHelp = ({ user, setModalMessage }) => {
    const [open, setOpen] = useState(false);
    const [canPrompt, setCanPrompt] = useState(canPromptInstall());
    const [pushSupported, setPushSupported] = useState(false);
    const [permission, setPermission] = useState(getPushPermission());
    const [enabling, setEnabling] = useState(false);
    const platform = detectPlatform();
    const navigate = useNavigate();

    useEffect(() => onInstallAvailabilityChange(setCanPrompt), []);
    useEffect(() => { isPushSupported().then(setPushSupported); }, []);

    // Don't show in the desktop client or when already installed/standalone.
    if (isElectron || isStandalone()) return null;

    const steps = platform === 'ios' ? IOS_STEPS : platform === 'android' ? ANDROID_STEPS : DESKTOP_STEPS;
    // On iOS, push only works once installed to the home screen.
    const canEnableHere = pushSupported && platform !== 'ios';

    const handleEnable = async () => {
        setEnabling(true);
        const res = await enablePush(user?.uid);
        setEnabling(false);
        setPermission(getPushPermission());
        if (res.ok) {
            setModalMessage?.('Push notifications enabled on this device.');
            setOpen(false);
        } else if (res.reason === 'denied') {
            setModalMessage?.('Notifications are blocked. Enable them in your browser settings for this site.');
        } else if (res.reason === 'unsupported') {
            setModalMessage?.('Push is not supported here. Install the app to your home screen first.');
        } else if (res.reason === 'no-vapid-key') {
            setModalMessage?.('Push is not configured yet. Please try again later.');
        } else if (res.reason === 'not-logged-in') {
            setModalMessage?.('Please log in to enable notifications.');
        } else {
            setModalMessage?.('Could not enable push notifications.');
        }
    };

    return (
        <>
            <button
                onClick={() => setOpen(true)}
                className="p-2 rounded-full hover:bg-gray-700"
                title="Notifications & install"
                aria-label="Notifications and install options"
            >
                <Icon path={ICONS.download} className="w-6 h-6 text-gray-300" />
            </button>

            {open && (
                <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50 p-4" onClick={() => setOpen(false)}>
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
                        <h2 className="text-xl font-bold text-gray-800 mb-2">Get notifications</h2>

                        {permission === 'granted' ? (
                            <p className="text-sm font-semibold text-green-600 mb-4">✓ Notifications are enabled in this browser.</p>
                        ) : (
                            <>
                                <p className="text-sm text-gray-500 mb-3">
                                    Turn on notifications to hear about follows, updates and community events —
                                    even when the site is closed.
                                </p>
                                {canEnableHere ? (
                                    <button
                                        onClick={handleEnable}
                                        disabled={enabling || !user}
                                        className="w-full mb-4 py-2.5 px-4 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-semibold disabled:opacity-50"
                                    >
                                        {enabling ? 'Enabling…' : (user ? 'Enable notifications' : 'Log in to enable')}
                                    </button>
                                ) : (
                                    <p className="text-sm text-gray-500 mb-4">
                                        {platform === 'ios'
                                            ? 'On iPhone/iPad, notifications require adding the app to your home screen (iOS 16.4 or newer). Follow the steps below.'
                                            : 'To receive notifications, install the app using the steps below.'}
                                    </p>
                                )}
                            </>
                        )}

                        <div className="border-t pt-4">
                            <h3 className="text-sm font-bold text-gray-700 mb-1">Install the web app (optional)</h3>
                            <p className="text-xs text-gray-500 mb-2">
                                Adds this website to your device as a standalone app for notifications and
                                quick access. It runs in your browser — no download.
                            </p>
                            <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
                                {steps.map((step, i) => <li key={i}>{step}</li>)}
                            </ol>
                            {canPrompt && (
                                <button
                                    onClick={async () => { await promptInstall(); setOpen(false); }}
                                    className="w-full mt-3 py-2.5 px-4 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-semibold"
                                >
                                    Install app
                                </button>
                            )}
                        </div>

                        {platform === 'desktop' && (
                            <div className="border-t mt-4 pt-4">
                                <h3 className="text-sm font-bold text-gray-700 mb-1">Or get the Desktop Client</h3>
                                <p className="text-xs text-gray-500 mb-3">
                                    Different from the web app: the PlanetCreations Client is a downloadable
                                    Windows program for managing your local game files — backups, one-click
                                    imports and the offline manager. The web app above is just this website
                                    installed; the client is a full desktop application.
                                </p>
                                <button
                                    onClick={() => { setOpen(false); navigate('/client-info'); }}
                                    className="w-full py-2.5 px-4 rounded-lg bg-gray-800 hover:bg-gray-900 text-white font-semibold flex items-center justify-center gap-2"
                                >
                                    <Icon path={ICONS.cog} className="w-5 h-5" solid />
                                    Learn about the Desktop Client
                                </button>
                            </div>
                        )}

                        <div className="flex justify-end gap-2 mt-6">
                            <button
                                onClick={() => setOpen(false)}
                                className="py-2 px-4 rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 font-semibold"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default InstallHelp;
