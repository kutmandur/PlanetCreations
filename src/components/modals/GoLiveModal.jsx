import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useQuery } from '@tanstack/react-query';
import { db } from '../../firebase/config';
import { ICONS, getYoutubeId } from '../../utils/helpers';
import { LIVE_PLATFORMS, isValidStreamUrl, setLiveSession } from '../../utils/liveStream';
import { setOverlayQr, buildCreationShareUrl } from '../../utils/overlayQr';
import { setStreamSession } from '../../utils/streamSession';
import Icon from '../ui/Icon';
import Spinner from '../ui/Spinner';

// Ordnet den OBS-Stream-Service ("Twitch", "YouTube - RTMPS", ...) einer
// unserer Plattformen zu; null wenn unbekannt (dann wählt der Nutzer manuell).
export const platformFromObsService = (service) => {
    if (typeof service !== 'string') return null;
    if (/twitch/i.test(service)) return 'twitch';
    if (/youtube/i.test(service)) return 'youtube';
    return null;
};

// "Creation mit dem Stream verbinden": wird beim OBS-Stream-Start von App.js
// geöffnet oder von der Kreationsseite mit vorgewählter Creation. Der Live-Status
// selbst wird ausschließlich server-seitig gesetzt (Callable goLive verifiziert
// über die Twitch-/YouTube-API, dass der Stream wirklich läuft).
const GoLiveModal = ({ user, userProfile, isElectron, obsService, initialCreation, onClose, setModalMessage }) => {
    const detectedPlatform = platformFromObsService(obsService);
    const [selectedCreationId, setSelectedCreationId] = useState(initialCreation?.id || '');
    const [platform, setPlatform] = useState(
        detectedPlatform || (userProfile?.twitch ? 'twitch' : (userProfile?.youtube ? 'youtube' : 'twitch'))
    );
    const [url, setUrl] = useState(userProfile?.[platform] || '');
    const [urlDirty, setUrlDirty] = useState(false);
    const secondaryPlatform = platform === 'twitch' ? 'youtube' : 'twitch';
    const [dualStream, setDualStream] = useState(false);
    const [secondaryUrl, setSecondaryUrl] = useState(userProfile?.[secondaryPlatform] || '');
    const [secondaryUrlDirty, setSecondaryUrlDirty] = useState(false);
    const [urlError, setUrlError] = useState('');
    const [alsoShowQr, setAlsoShowQr] = useState(true);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [clientId, setClientId] = useState(null);

    useEffect(() => {
        let cancelled = false;
        window.electronAPI?.getClientIdentity?.().then((identity) => {
            if (!cancelled) setClientId(identity?.clientId || null);
        }).catch(() => {});
        return () => { cancelled = true; };
    }, []);

    // Eigene Creations für den Picker (nur Query auf userId — braucht keinen
    // Composite-Index; Sortierung client-seitig nach letzter Änderung).
    const { data: ownCreations, isLoading: loadingCreations } = useQuery({
        queryKey: ['ownCreations', user?.uid],
        enabled: Boolean(user?.uid),
        staleTime: 5 * 60 * 1000,
        queryFn: async () => {
            const snapshot = await getDocs(query(collection(db, 'creations'), where('userId', '==', user.uid)));
            return snapshot.docs
                .map((d) => ({ id: d.id, ...d.data() }))
                .filter((creation) => !creation.sourceCollaborationId)
                .sort((a, b) => ((b.updatedAt?.seconds || b.createdAt?.seconds || 0) - (a.updatedAt?.seconds || a.createdAt?.seconds || 0)));
        },
    });

    const creations = useMemo(
        () => ownCreations || (initialCreation ? [initialCreation] : []),
        [ownCreations, initialCreation],
    );

    useEffect(() => {
        if (!selectedCreationId && creations.length > 0) setSelectedCreationId(creations[0].id);
    }, [creations, selectedCreationId]);

    // Plattformwechsel füllt die URL aus den Profil-Socials neu vor, solange der
    // Nutzer das Feld nicht selbst angefasst hat.
    const handlePlatformChange = (nextPlatform) => {
        setPlatform(nextPlatform);
        setUrlError('');
        if (!urlDirty) setUrl(userProfile?.[nextPlatform] || '');
        const nextSecondary = nextPlatform === 'twitch' ? 'youtube' : 'twitch';
        if (!secondaryUrlDirty) setSecondaryUrl(userProfile?.[nextSecondary] || '');
    };

    const handleSubmit = async () => {
        const trimmedUrl = url.trim();
        if (!selectedCreationId) {
            setUrlError('Please pick a creation first.');
            return;
        }
        if (!isValidStreamUrl(platform, trimmedUrl)) {
            setUrlError(`Please enter a valid https ${LIVE_PLATFORMS[platform].label} URL (e.g. ${LIVE_PLATFORMS[platform].placeholder}).`);
            return;
        }
        if (platform === 'youtube' && !getYoutubeId(trimmedUrl)) {
            setUrlError('For YouTube, please paste the URL of your live video (watch?v=... or youtu.be/...), not just your channel.');
            return;
        }
        const trimmedSecondaryUrl = secondaryUrl.trim();
        if (dualStream && !isValidStreamUrl(secondaryPlatform, trimmedSecondaryUrl)) {
            setUrlError(`Please enter a valid https ${LIVE_PLATFORMS[secondaryPlatform].label} URL for the second output.`);
            return;
        }
        if (dualStream && secondaryPlatform === 'youtube' && !getYoutubeId(trimmedSecondaryUrl)) {
            setUrlError('For the YouTube output, please paste the URL of the live video, not just the channel.');
            return;
        }
        setUrlError('');
        setIsSubmitting(true);
        try {
            const goLive = httpsCallable(getFunctions(), 'goLive');
            const result = await goLive({
                creationId: selectedCreationId,
                platform,
                url: trimmedUrl,
                primaryPlatform: platform,
                streams: [
                    { platform, url: trimmedUrl },
                    ...(dualStream ? [{ platform: secondaryPlatform, url: trimmedSecondaryUrl }] : []),
                ],
                clientId,
                showQr: alsoShowQr,
                experimentalAuto: false,
                selectionMode: 'manual',
            });
            const creation = creations.find((c) => c.id === selectedCreationId);
            setLiveSession({
                creationId: selectedCreationId,
                platform,
                platforms: Object.keys(result.data?.session?.streams || {[platform]: true}),
                sessionId: result.data?.session?.sessionId || null,
            });
            setStreamSession(result.data?.session || null);
            if (isElectron && alsoShowQr) {
                setOverlayQr({
                    creationId: selectedCreationId,
                    title: creation?.title || '',
                    url: buildCreationShareUrl(selectedCreationId),
                    source: 'goLive',
                    enabledAt: Date.now(),
                });
            }
            setModalMessage(`You are now live with "${creation?.title || 'your creation'}"! The LIVE badge is visible to everyone.`);
            onClose();
        } catch (error) {
            if (error?.code === 'functions/failed-precondition') {
                setUrlError(error.message || "We couldn't find every selected live output — start streaming first, then try again.");
            } else {
                setUrlError(`Going live failed: ${error.message}`);
            }
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100 mb-2 flex items-center gap-2">
                    <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-500 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-red-600"></span>
                    </span>
                    Link a creation to your stream
                </h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                    Viewers of the creation page will see a LIVE badge with a link to your stream. It ends automatically when your stream stops.
                </p>

                <label className="block text-sm font-bold text-gray-600 dark:text-gray-300 mb-1">Creation</label>
                {loadingCreations && creations.length === 0 ? (
                    <div className="h-10 bg-gray-200 dark:bg-gray-700 rounded-lg animate-pulse mb-4"></div>
                ) : creations.length === 0 ? (
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">You have no creations yet — upload one first to link it to a stream.</p>
                ) : (
                    <select
                        value={selectedCreationId}
                        onChange={(e) => setSelectedCreationId(e.target.value)}
                        className="w-full mb-4 p-2 border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                        aria-label="Creation to link to your stream"
                    >
                        {creations.map((c) => (
                            <option key={c.id} value={c.id}>{c.title}</option>
                        ))}
                    </select>
                )}

                <label className="block text-sm font-bold text-gray-600 dark:text-gray-300 mb-1">
                    Primary platform{detectedPlatform ? ' (detected from OBS)' : ''}
                </label>
                <div className="grid grid-cols-2 gap-3 mb-4">
                    {Object.entries(LIVE_PLATFORMS).map(([key, info]) => (
                        <button
                            key={key}
                            type="button"
                            onClick={() => handlePlatformChange(key)}
                            className={`flex items-center justify-center gap-2 p-3 rounded-lg border-2 font-semibold transition-colors ${platform === key
                                ? 'border-red-500 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-300'
                                : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:border-gray-300 dark:hover:border-gray-500'}`}
                        >
                            <Icon path={key === 'twitch' ? ICONS.twitch : ICONS.youtube} className="w-5 h-5" solid />
                            {info.label}
                        </button>
                    ))}
                </div>

                <label className="block text-sm font-bold text-gray-600 dark:text-gray-300 mb-1">Stream URL</label>
                <input
                    type="url"
                    value={url}
                    onChange={(e) => { setUrl(e.target.value); setUrlDirty(true); setUrlError(''); }}
                    placeholder={LIVE_PLATFORMS[platform].placeholder}
                    className="w-full p-2 border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-400"
                />
                {urlError && <p className="text-sm text-red-500 mt-1">{urlError}</p>}

                <label className="flex items-start gap-3 mt-4 rounded-lg border dark:border-gray-600 p-3 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
                    <input
                        type="checkbox"
                        checked={dualStream}
                        onChange={(e) => { setDualStream(e.target.checked); setUrlError(''); }}
                        className="w-4 h-4 mt-0.5"
                    />
                    <span>
                        <strong className="block">Dual stream</strong>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Link the same creation on Twitch and YouTube.</span>
                    </span>
                </label>

                {dualStream && (
                    <label className="block text-sm font-bold text-gray-600 dark:text-gray-300 mt-4">
                        {LIVE_PLATFORMS[secondaryPlatform].label} stream URL
                        <input
                            type="url"
                            value={secondaryUrl}
                            onChange={(e) => { setSecondaryUrl(e.target.value); setSecondaryUrlDirty(true); setUrlError(''); }}
                            placeholder={LIVE_PLATFORMS[secondaryPlatform].placeholder}
                            className="mt-1 w-full p-2 border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-red-400"
                        />
                    </label>
                )}

                {isElectron && (
                    <label className="flex items-center gap-2 mt-4 text-sm text-gray-700 dark:text-gray-200 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={alsoShowQr}
                            onChange={(e) => setAlsoShowQr(e.target.checked)}
                            className="w-4 h-4"
                        />
                        Also show this Creation's QR code in the In-Game Overlay
                    </label>
                )}

                <div className="flex justify-end gap-2 mt-6">
                    <button onClick={onClose} className="py-2 px-4 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 font-semibold">
                        Not now
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || creations.length === 0}
                        className="py-2 px-6 rounded-lg bg-red-600 hover:bg-red-700 text-white font-semibold disabled:opacity-50 flex items-center gap-2"
                    >
                        {isSubmitting ? <Spinner size="small" /> : 'Go Live'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default GoLiveModal;
