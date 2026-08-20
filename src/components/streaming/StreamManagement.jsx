import React, { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useQuery } from '@tanstack/react-query';
import { db } from '../../firebase/config';
import { getYoutubeId } from '../../utils/helpers';
import { LIVE_PLATFORMS, isValidStreamUrl, setLiveSession } from '../../utils/liveStream';
import { buildCreationShareUrl, setOverlayQr } from '../../utils/overlayQr';
import {
    readStreamSession,
    setGeneralOverlayNotificationPrefs,
    setStreamSession,
    subscribeStreamSession,
} from '../../utils/streamSession';
import GeneralOverlayNotificationSettings from '../ui/GeneralOverlayNotificationSettings';
import Spinner from '../ui/Spinner';
import { platformFromObsService } from '../modals/GoLiveModal';
import { getDefaultGameId, getGames } from '../../utils/gamesRegistry';

const AUTO_MODE_KEY_PREFIX = 'pc.experimentalStreamAuto.';

const timestampMillis = (value) => {
    if (!value) return 0;
    if (typeof value.toMillis === 'function') return value.toMillis();
    if (typeof value.seconds === 'number') return value.seconds * 1000;
    if (typeof value._seconds === 'number') return value._seconds * 1000;
    return 0;
};

const StreamManagement = ({
    user,
    userProfile,
    startContext,
    activeGameId,
    localClientId,
    onClose,
}) => {
    const [session, setSession] = useState(() => readStreamSession());
    const detectedPlatform = platformFromObsService(startContext?.service);
    const [platform, setPlatform] = useState(
        detectedPlatform || (userProfile?.twitch ? 'twitch' : (userProfile?.youtube ? 'youtube' : 'twitch')),
    );
    const [url, setUrl] = useState(userProfile?.[platform] || '');
    const secondaryPlatform = platform === 'twitch' ? 'youtube' : 'twitch';
    const [dualStream, setDualStream] = useState(false);
    const [secondaryUrl, setSecondaryUrl] = useState(userProfile?.[secondaryPlatform] || '');
    const [selectedCreationId, setSelectedCreationId] = useState('');
    const [selectedGameId, setSelectedGameId] = useState(activeGameId || getDefaultGameId());
    const [preview, setPreview] = useState(null);
    const [error, setError] = useState('');
    const [working, setWorking] = useState(false);
    const [showQr, setShowQr] = useState(true);
    const [muteMinutes, setMuteMinutes] = useState(30);
    const autoStorageKey = `${AUTO_MODE_KEY_PREFIX}${localClientId || 'browser'}`;
    const [experimentalAuto, setExperimentalAuto] = useState(() => {
        try { return localStorage.getItem(autoStorageKey) === 'true'; } catch (e) { return false; }
    });

    useEffect(() => subscribeStreamSession(setSession), []);

    const { data: ownCreations = [], isLoading } = useQuery({
        queryKey: ['streamOwnCreations', user?.uid],
        enabled: Boolean(user?.uid),
        staleTime: 2 * 60 * 1000,
        queryFn: async () => {
            const snapshot = await getDocs(query(collection(db, 'creations'), where('userId', '==', user.uid)));
            return snapshot.docs
                .map((item) => ({ id: item.id, ...item.data() }))
                .filter((creation) => !creation.sourceCollaborationId)
                .sort((a, b) => (
                    (b.updatedAt?.seconds || b.createdAt?.seconds || 0) -
                    (a.updatedAt?.seconds || a.createdAt?.seconds || 0)
                ));
        },
    });

    const eligibleCreations = useMemo(() => {
        const gameId = session?.creationGame || preview?.gameId || selectedGameId || null;
        const eligible = gameId ? ownCreations.filter((creation) => creation.game === gameId) : ownCreations;
        const order = new Map((session?.suggestions || preview?.suggestions || [])
            .map((suggestion, index) => [suggestion.creationId, index]));
        return [...eligible].sort((a, b) => (
            (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999)
        ));
    }, [ownCreations, preview, selectedGameId, session]);

    useEffect(() => {
        if (!selectedCreationId && eligibleCreations.length) {
            setSelectedCreationId(session?.creationId || preview?.bestCreationId || eligibleCreations[0].id);
        }
    }, [eligibleCreations, preview?.bestCreationId, selectedCreationId, session?.creationId]);

    useEffect(() => {
        if (session?.creationId) setSelectedCreationId(session.creationId);
    }, [session?.creationId]);

    const validateUrl = () => {
        const value = url.trim();
        if (!isValidStreamUrl(platform, value)) {
            throw new Error(`Enter a valid ${LIVE_PLATFORMS[platform].label} stream URL.`);
        }
        if (platform === 'youtube' && !getYoutubeId(value)) {
            throw new Error('Paste the URL of the current YouTube live video, not the channel URL.');
        }
        return value;
    };

    const validateStreams = () => {
        const primaryUrl = validateUrl();
        if (!dualStream) return [{ platform, url: primaryUrl }];
        const secondUrl = secondaryUrl.trim();
        if (!isValidStreamUrl(secondaryPlatform, secondUrl)) {
            throw new Error(`Enter a valid ${LIVE_PLATFORMS[secondaryPlatform].label} stream URL.`);
        }
        if (secondaryPlatform === 'youtube' && !getYoutubeId(secondUrl)) {
            throw new Error('Paste the URL of the current YouTube live video for the second output.');
        }
        return [
            { platform, url: primaryUrl },
            { platform: secondaryPlatform, url: secondUrl },
        ];
    };

    const beginLive = async (creationId, selectionMode) => {
        let streams;
        try {
            streams = validateStreams();
        } catch (validationError) {
            setError(validationError.message);
            return;
        }
        const streamUrl = streams[0].url;
        setWorking(true);
        setError('');
        try {
            const result = await httpsCallable(getFunctions(), 'goLive')({
                creationId,
                platform,
                url: streamUrl,
                primaryPlatform: platform,
                streams,
                clientId: localClientId || null,
                game: selectedGameId || preview?.gameId || null,
                showQr,
                experimentalAuto,
                selectionMode,
            });
            const nextSession = result.data?.session || null;
            setStreamSession(nextSession);
            setSession(nextSession);
            setLiveSession({
                creationId,
                platform,
                platforms: Object.keys(nextSession?.streams || {[platform]: true}),
                sessionId: nextSession?.sessionId || null,
            });
            const creation = ownCreations.find((item) => item.id === creationId);
            if (showQr && creation) {
                setOverlayQr({
                    creationId,
                    title: creation.title || '',
                    url: buildCreationShareUrl(creationId),
                    source: 'goLive',
                    enabledAt: Date.now(),
                });
            }
        } catch (requestError) {
            setError(requestError?.message || 'The stream could not be linked.');
        } finally {
            setWorking(false);
        }
    };

    const analyze = async ({ autoStart = false } = {}) => {
        let streamUrl;
        try {
            streamUrl = validateUrl();
        } catch (validationError) {
            setError(validationError.message);
            return;
        }
        setWorking(true);
        setError('');
        try {
            const result = await httpsCallable(getFunctions(), 'getLiveCreationSuggestions')({
                platform,
                url: streamUrl,
                game: selectedGameId || null,
            });
            const nextPreview = result.data;
            setPreview(nextPreview);
            if (nextPreview.bestCreationId) setSelectedCreationId(nextPreview.bestCreationId);
            if (autoStart && nextPreview.confident && nextPreview.bestCreationId) {
                setWorking(false);
                await beginLive(nextPreview.bestCreationId, 'auto');
            }
        } catch (requestError) {
            setError(requestError?.message || 'The stream title could not be analyzed.');
        } finally {
            setWorking(false);
        }
    };

    useEffect(() => {
        if (session || !url || !isValidStreamUrl(platform, url)) return undefined;
        const timer = setTimeout(() => analyze({ autoStart: experimentalAuto }), 500);
        return () => clearTimeout(timer);
        // Analyze once when the stream management picker opens. Subsequent URL
        // edits use the explicit button to avoid repeated platform API calls.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [session]);

    const setAutoMode = async (enabled) => {
        setExperimentalAuto(enabled);
        try { localStorage.setItem(autoStorageKey, String(enabled)); } catch (e) { /* noop */ }
        if (!session) return;
        try {
            const result = await httpsCallable(getFunctions(), 'updateLiveSessionPreferences')({
                sessionId: session.sessionId,
                experimentalAuto: enabled,
                clientId: localClientId,
            });
            setStreamSession(result.data?.session);
        } catch (requestError) {
            setError(requestError.message);
        }
    };

    const switchCreation = async (creationId) => {
        if (!session || creationId === session.creationId) return;
        setWorking(true);
        setError('');
        try {
            const result = await httpsCallable(getFunctions(), 'switchLiveCreation')({
                sessionId: session.sessionId,
                expectedRevision: session.selectionRevision,
                creationId,
            });
            setStreamSession(result.data?.session);
            setSelectedCreationId(creationId);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setWorking(false);
        }
    };

    const dismissNotification = async (notificationId) => {
        try {
            const result = await httpsCallable(getFunctions(), 'dismissStreamNotification')({
                sessionId: session.sessionId,
                notificationId,
            });
            setStreamSession(result.data?.session);
        } catch (requestError) {
            setError(requestError.message);
        }
    };

    const updateMute = async (muteMode) => {
        try {
            const result = await httpsCallable(getFunctions(), 'updateLiveSessionPreferences')({
                sessionId: session.sessionId,
                muteMode,
                minutes: Number(muteMinutes),
            });
            setStreamSession(result.data?.session);
        } catch (requestError) {
            setError(requestError.message);
        }
    };

    const muteAll = async (muteMode) => {
        if (muteMode === 'minutes') {
            setGeneralOverlayNotificationPrefs({
                enabled: true,
                permanentlyMuted: false,
                mutedForStreamSessionId: null,
                mutedUntil: Date.now() + Math.max(1, Math.min(1440, Number(muteMinutes) || 30)) * 60 * 1000,
            });
        } else if (muteMode === 'session') {
            setGeneralOverlayNotificationPrefs({
                enabled: true,
                permanentlyMuted: false,
                mutedUntil: 0,
                mutedForStreamSessionId: session.sessionId,
            });
        } else if (muteMode === 'permanent') {
            setGeneralOverlayNotificationPrefs({
                enabled: true,
                permanentlyMuted: true,
                mutedUntil: 0,
                mutedForStreamSessionId: null,
            });
        } else {
            setGeneralOverlayNotificationPrefs({
                enabled: true,
                permanentlyMuted: false,
                mutedUntil: 0,
                mutedForStreamSessionId: null,
            });
        }
        await updateMute(muteMode);
    };

    const endPlanetCreationsLive = async () => {
        setWorking(true);
        try {
            await httpsCallable(getFunctions(), 'endLive')({ creationId: session.creationId });
            setLiveSession(null);
            setStreamSession(null);
            setOverlayQr(null);
        } catch (requestError) {
            setError(requestError.message);
        } finally {
            setWorking(false);
        }
    };

    const streamPrefs = session?.streamNotificationPrefs || {};
    const isStreamingDevice = !session?.streamingClientId || session.streamingClientId === localClientId;
    const streamMuted = streamPrefs.mode === 'session' || streamPrefs.mode === 'permanent' ||
        timestampMillis(streamPrefs.mutedUntil) > Date.now();

    return (
        <div className="h-screen overflow-y-auto bg-gray-100 dark:bg-gray-950 p-3 text-gray-900 dark:text-gray-100">
            <div className="mx-auto max-w-xl rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border dark:border-gray-700 overflow-hidden">
                <header className="sticky top-0 z-10 flex items-center justify-between gap-3 bg-gray-900 px-4 py-3 text-white">
                    <div>
                        <p className="text-xs font-semibold uppercase tracking-widest text-red-300">Live tools</p>
                        <h1 className="font-bold">Stream Management</h1>
                    </div>
                    <button type="button" onClick={onClose} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm hover:bg-white/20">Close</button>
                </header>

                <main className="space-y-5 p-4">
                    {error && <p className="rounded-lg bg-red-50 dark:bg-red-950/50 p-3 text-sm text-red-700 dark:text-red-300">{error}</p>}

                    {!session ? (
                        <>
                            <section>
                                <h2 className="font-bold">Choose the creation for this stream</h2>
                                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                                    The picker is standard. Experimental Auto Mode only starts automatically when one match is clearly ahead.
                                </p>
                            </section>
                            <label className="block text-sm font-semibold">
                                Primary platform (used for title matching)
                                <select value={platform} onChange={(event) => {
                                    const next = event.target.value;
                                    setPlatform(next);
                                    setUrl(userProfile?.[next] || '');
                                    setSecondaryUrl(userProfile?.[next === 'twitch' ? 'youtube' : 'twitch'] || '');
                                    setPreview(null);
                                }} className="mt-1 w-full rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-800 p-2">
                                    {Object.entries(LIVE_PLATFORMS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
                                </select>
                            </label>
                            <label className="block text-sm font-semibold">
                                Game
                                <select value={selectedGameId} onChange={(event) => { setSelectedGameId(event.target.value); setPreview(null); setSelectedCreationId(''); }} className="mt-1 w-full rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-800 p-2">
                                    {getGames().map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}
                                </select>
                            </label>
                            <label className="block text-sm font-semibold">
                                Stream URL
                                <input value={url} onChange={(event) => { setUrl(event.target.value); setPreview(null); }} type="url" className="mt-1 w-full rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-800 p-2" placeholder={LIVE_PLATFORMS[platform].placeholder} />
                            </label>
                            <label className="flex items-start gap-3 rounded-xl border dark:border-gray-700 p-3">
                                <input type="checkbox" checked={dualStream} onChange={(event) => setDualStream(event.target.checked)} className="mt-1 h-4 w-4" />
                                <span>
                                    <strong className="block text-sm">Dual stream</strong>
                                    <span className="text-xs text-gray-500 dark:text-gray-400">Use one PlanetCreations session for Twitch and YouTube.</span>
                                </span>
                            </label>
                            {dualStream && (
                                <label className="block text-sm font-semibold">
                                    {LIVE_PLATFORMS[secondaryPlatform].label} stream URL
                                    <input value={secondaryUrl} onChange={(event) => setSecondaryUrl(event.target.value)} type="url" className="mt-1 w-full rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-800 p-2" placeholder={LIVE_PLATFORMS[secondaryPlatform].placeholder} />
                                </label>
                            )}
                            <button type="button" disabled={working} onClick={() => analyze()} className="w-full rounded-lg bg-gray-200 dark:bg-gray-700 py-2 text-sm font-bold disabled:opacity-50">
                                {working ? 'Checking stream…' : 'Analyze stream title'}
                            </button>
                            {preview?.streamTitle && (
                                <div className="rounded-lg bg-blue-50 dark:bg-blue-950/40 p-3 text-sm">
                                    <p className="font-semibold">{preview.streamTitle}</p>
                                    <p className="text-xs text-gray-500 dark:text-gray-400">{preview.categoryName || 'Category unavailable'}</p>
                                </div>
                            )}
                            <label className="block text-sm font-semibold">
                                Creation
                                {isLoading ? <Spinner /> : (
                                    <select value={selectedCreationId} onChange={(event) => setSelectedCreationId(event.target.value)} className="mt-1 w-full rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-800 p-2">
                                        {eligibleCreations.map((creation) => <option key={creation.id} value={creation.id}>{creation.title} — {creation.category}</option>)}
                                    </select>
                                )}
                            </label>
                            <label className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 dark:bg-amber-950/30 p-3">
                                <input type="checkbox" checked={experimentalAuto} onChange={(event) => setAutoMode(event.target.checked)} className="mt-1 h-4 w-4" />
                                <span>
                                    <strong className="block text-sm">Experimental Auto Mode</strong>
                                    <span className="text-xs text-gray-600 dark:text-gray-300">Opt-in only. Uses the title, creation names, tags and type. Ambiguous matches stay in the picker.</span>
                                </span>
                            </label>
                            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={showQr} onChange={(event) => setShowQr(event.target.checked)} /> Show the creation QR in the overlay</label>
                            <button type="button" disabled={working || !selectedCreationId} onClick={() => beginLive(selectedCreationId, 'manual')} className="w-full rounded-xl bg-red-600 py-3 font-bold text-white hover:bg-red-700 disabled:opacity-50">
                                {working ? 'Linking…' : 'Go Live with selected creation'}
                            </button>
                        </>
                    ) : (
                        <>
                            <section className="rounded-xl bg-red-50 dark:bg-red-950/30 p-4">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-bold uppercase tracking-wider text-red-600">Currently linked</p>
                                        <h2 className="text-lg font-bold">{session.creationTitle}</h2>
                                    </div>
                                    <span className="rounded-full bg-red-600 px-3 py-1 text-xs font-bold text-white">LIVE</span>
                                </div>
                                <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">{session.streamTitle}</p>
                                {session.categoryName && <p className="text-xs text-gray-500">{session.categoryName}</p>}
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {Object.entries(session.streams || {[session.platform]: {url: session.url}}).map(([streamPlatform, stream]) => (
                                        <a key={streamPlatform} href={stream.url} target="_blank" rel="noreferrer" className="rounded-full bg-white/80 dark:bg-gray-900/70 px-3 py-1 text-xs font-bold text-red-700 dark:text-red-300">
                                            {LIVE_PLATFORMS[streamPlatform]?.label || streamPlatform} connected
                                        </a>
                                    ))}
                                </div>
                            </section>

                            <section>
                                <h2 className="font-bold">Change creation</h2>
                                <div className="mt-2 flex gap-2">
                                    <select value={selectedCreationId || session.creationId} onChange={(event) => setSelectedCreationId(event.target.value)} className="min-w-0 flex-1 rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-800 p-2">
                                        {eligibleCreations.map((creation) => <option key={creation.id} value={creation.id}>{creation.title} — {creation.category}</option>)}
                                    </select>
                                    <button type="button" disabled={working || !selectedCreationId || selectedCreationId === session.creationId} onClick={() => switchCreation(selectedCreationId)} className="rounded-lg bg-blue-600 px-4 text-sm font-bold text-white disabled:opacity-50">Change</button>
                                </div>
                                {session.manualSelectionLocked && <p className="mt-2 text-xs text-amber-600">Automatic switching is locked for this session after a manual selection. Better matches will be suggested instead.</p>}
                            </section>

                            <section>
                                <div className="flex items-center justify-between">
                                    <h2 className="font-bold">Stream notifications</h2>
                                    {streamMuted && <span className="text-xs font-semibold text-gray-500">Muted</span>}
                                </div>
                                <div className="mt-2 space-y-2">
                                    {(session.notifications || []).length === 0 && <p className="text-sm text-gray-500">No stream notifications.</p>}
                                    {(session.notifications || []).map((notification) => (
                                        <article key={notification.id} className="rounded-xl border dark:border-gray-700 p-3">
                                            <h3 className="text-sm font-bold">{notification.title}</h3>
                                            <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{notification.message}</p>
                                            <div className="mt-3 flex flex-wrap gap-2">
                                                {notification.proposalCreationId && (
                                                    <button type="button" onClick={() => switchCreation(notification.proposalCreationId)} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white">Switch to {notification.proposalCreationTitle}</button>
                                                )}
                                                <button type="button" onClick={() => dismissNotification(notification.id)} className="rounded-lg bg-gray-200 dark:bg-gray-700 px-3 py-1.5 text-xs font-semibold">Ignore</button>
                                            </div>
                                        </article>
                                    ))}
                                </div>
                            </section>

                            <section className="rounded-xl border dark:border-gray-700 p-4">
                                <h2 className="font-bold">Stream notification settings</h2>
                                <div className="mt-3 flex flex-wrap items-center gap-2">
                                    <input type="number" min="1" max="1440" value={muteMinutes} onChange={(event) => setMuteMinutes(event.target.value)} className="w-20 rounded-lg border dark:border-gray-600 bg-white dark:bg-gray-800 px-2 py-1.5 text-sm" />
                                    <button type="button" onClick={() => updateMute('minutes')} className="rounded-lg bg-gray-200 dark:bg-gray-700 px-3 py-1.5 text-xs font-semibold">Mute minutes</button>
                                    <button type="button" onClick={() => updateMute('session')} className="rounded-lg bg-gray-200 dark:bg-gray-700 px-3 py-1.5 text-xs font-semibold">During this stream</button>
                                    <button type="button" onClick={() => updateMute('permanent')} className="rounded-lg bg-gray-200 dark:bg-gray-700 px-3 py-1.5 text-xs font-semibold">Until enabled</button>
                                    {streamPrefs.mode && streamPrefs.mode !== 'off' && <button type="button" onClick={() => updateMute('off')} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">Unmute</button>}
                                </div>
                                <label className="mt-4 flex items-start gap-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3">
                                    <input type="checkbox" disabled={!isStreamingDevice} checked={session.experimentalAuto === true} onChange={(event) => setAutoMode(event.target.checked)} className="mt-1 disabled:opacity-50" />
                                    <span><strong className="block text-sm">Experimental Auto Mode</strong><span className="text-xs">{isStreamingDevice ? 'Manual changes keep automatic switching locked; title suggestions continue.' : 'This setting is controlled by the streaming device.'}</span></span>
                                </label>
                            </section>

                            <section className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/20 p-4">
                                <h2 className="font-bold">Quick mute all overlay popovers</h2>
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">Applies the same duration to general and stream notifications. Bell history is not affected.</p>
                                <div className="mt-3 flex flex-wrap gap-2">
                                    <button type="button" onClick={() => muteAll('minutes')} className="rounded-lg bg-gray-200 dark:bg-gray-700 px-3 py-1.5 text-xs font-semibold">{muteMinutes || 30} minutes</button>
                                    <button type="button" onClick={() => muteAll('session')} className="rounded-lg bg-gray-200 dark:bg-gray-700 px-3 py-1.5 text-xs font-semibold">During this stream</button>
                                    <button type="button" onClick={() => muteAll('permanent')} className="rounded-lg bg-gray-200 dark:bg-gray-700 px-3 py-1.5 text-xs font-semibold">Until enabled</button>
                                    <button type="button" onClick={() => muteAll('off')} className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white">Unmute all</button>
                                </div>
                            </section>

                            <GeneralOverlayNotificationSettings />

                            <button type="button" disabled={working} onClick={endPlanetCreationsLive} className="w-full rounded-xl border border-red-300 py-2 text-sm font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30">
                                End PlanetCreations live mode
                            </button>
                        </>
                    )}
                </main>
            </div>
        </div>
    );
};

export default StreamManagement;
