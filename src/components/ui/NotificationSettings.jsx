import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { enablePush, getPushPermission, isPushSupported } from '../../firebase/push';
import Spinner from './Spinner';

const TYPES = [
    { key: 'newCreation', label: 'New creation from a creator you follow' },
    { key: 'creationUpdate', label: 'Updates to a creation you follow' },
    { key: 'communityEvent', label: 'Community events' },
    { key: 'eventSubmission', label: 'Confirmation when you submit to an event' },
    { key: 'eventResults', label: 'Results of events you participated in' },
    { key: 'collaborationInvite', label: 'Collaboration invitations' },
    { key: 'collaborationAvailable', label: 'Collaboration build turns becoming available' },
    { key: 'newFollower', label: 'Someone follows you' },
];

// Global notification preferences + push opt-in. Prefs live on the inbox doc
// (users/{uid}/meta/inbox.prefs); a missing entry defaults to on for both
// channels. Per-community event toggles live on the community page.
const NotificationSettings = ({ user, setModalMessage, embedded = false }) => {
    const [prefs, setPrefs] = useState({});
    const [loading, setLoading] = useState(true);
    const [pushSupported, setPushSupported] = useState(false);
    const [permission, setPermission] = useState(getPushPermission());
    const [enabling, setEnabling] = useState(false);

    const inboxRef = doc(db, 'users', user.uid, 'meta', 'inbox');

    useEffect(() => {
        let mounted = true;
        (async () => {
            setPushSupported(await isPushSupported());
            try {
                const snap = await getDoc(inboxRef);
                if (mounted && snap.exists()) setPrefs(snap.data().prefs || {});
            } catch (e) { /* ignore */ }
            if (mounted) setLoading(false);
        })();
        return () => { mounted = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user.uid]);

    const allows = (type, channel) => {
        const p = prefs[type];
        if (!p) return true;
        return p[channel] !== false;
    };

    const toggle = async (type, channel) => {
        const current = allows(type, channel);
        const next = {
            ...prefs,
            [type]: {
                inApp: channel === 'inApp' ? !current : allows(type, 'inApp'),
                push: channel === 'push' ? !current : allows(type, 'push'),
            },
        };
        setPrefs(next);
        try {
            await setDoc(inboxRef, { prefs: next }, { merge: true });
        } catch (e) {
            setModalMessage(`Could not save notification settings: ${e.message}`);
        }
    };

    const handleEnablePush = async () => {
        setEnabling(true);
        const res = await enablePush(user.uid);
        setEnabling(false);
        setPermission(getPushPermission());
        if (res.ok) {
            setModalMessage('Push notifications enabled on this device.');
        } else if (res.reason === 'denied') {
            setModalMessage('Notifications are blocked. Enable them in your browser settings for this site.');
        } else if (res.reason === 'unsupported') {
            setModalMessage('Push is not supported here. On iPhone/iPad, add the app to your home screen first.');
        } else if (res.reason === 'no-vapid-key') {
            setModalMessage('Push is not configured yet (missing VAPID key). Please try again later.');
        } else {
            setModalMessage('Could not enable push notifications.');
        }
    };

    return (
        <div className={embedded ? '' : 'bg-white p-6 rounded-lg shadow-md'}>
            {!embedded && <h2 className="text-2xl font-bold mb-2">Notifications</h2>}
            <p className={`text-gray-600 dark:text-gray-300 mb-4 ${embedded ? 'text-center' : ''}`}>
                Choose what you get notified about. “In-app” shows in the bell; “Push” also
                sends a notification to this device when the site is closed.
            </p>

            <div className="mb-5">
                {permission === 'granted' ? (
                    <p className="text-sm font-semibold text-green-600">✓ Push notifications are enabled on this device.</p>
                ) : (
                    <button
                        onClick={handleEnablePush}
                        disabled={enabling || !pushSupported}
                        className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {enabling ? <Spinner size="small" /> : (pushSupported ? 'Enable push on this device' : 'Push not available here')}
                    </button>
                )}
                {!pushSupported && (
                    <p className="text-xs text-gray-400 mt-1">
                        On iPhone/iPad, install the app to your home screen first (use the install icon in the top bar).
                    </p>
                )}
            </div>

            {loading ? <Spinner /> : (
                <div className="overflow-x-auto">
                    <table className="min-w-full text-left text-sm">
                        <thead className="border-b">
                            <tr>
                                <th className="py-2 pr-4 font-semibold">Notify me about</th>
                                <th className="py-2 px-3 font-semibold text-center">In-app</th>
                                <th className="py-2 px-3 font-semibold text-center">Push</th>
                            </tr>
                        </thead>
                        <tbody>
                            {TYPES.map(({ key, label }) => (
                                <tr key={key} className="border-b last:border-0">
                                    <td className="py-3 pr-4 text-gray-700">{label}</td>
                                    <td className="py-3 px-3 text-center">
                                        <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" checked={allows(key, 'inApp')} onChange={() => toggle(key, 'inApp')} />
                                    </td>
                                    <td className="py-3 px-3 text-center">
                                        <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" checked={allows(key, 'push')} onChange={() => toggle(key, 'push')} />
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default NotificationSettings;
