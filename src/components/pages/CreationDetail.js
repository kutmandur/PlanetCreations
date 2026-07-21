import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useParams } from 'react-router-dom';
import { onSnapshot, doc, getDoc, setDoc, collection, writeBatch, serverTimestamp, deleteDoc, query, where, documentId, getDocs, increment, arrayUnion, arrayRemove, updateDoc } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useQueryClient } from '@tanstack/react-query';
import { db } from '../../firebase/config';
import { getGameColor, ICONS, getYoutubeThumbnailUrl, getYoutubeEmbed } from '../../utils/helpers';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import CommunityInfoCard from '../cards/CommunityInfoCard';
import CreationSharingQrCode from '../ui/CreationSharingQrCode';
import GoLiveModal from '../modals/GoLiveModal';
import { recordView, recordVote } from '../../utils/interestTracker';
import { LIVE_PLATFORMS, isLiveStreamActive, readLiveSession, setLiveSession } from '../../utils/liveStream';
import { readOverlayQr, setOverlayQr, subscribeOverlayQr, buildCreationShareUrl } from '../../utils/overlayQr';
import { scheduleDataRefresh } from '../../utils/appRefresh';

const CreationDetail = ({ user, userProfile, setModalMessage, setConfirmation, setExternalLink, setReportModal, creationIdOverride }) => {
    const { id: idFromUrl } = useParams();
    const id = creationIdOverride || idFromUrl;
    const queryClient = useQueryClient();

    // Versuche Creation aus Cache zu laden für sofortige Anzeige
    const cachedCreation = queryClient.getQueryData(['creation', id]);

    const [creation, setCreation] = useState(cachedCreation || null);
    const [loadingCreation, setLoadingCreation] = useState(!cachedCreation);
    const [isVoting, setIsVoting] = useState(false);
    const [isFollowing, setIsFollowing] = useState(false);
    const [isFollowingCreation, setIsFollowingCreation] = useState(false);
    const [isTogglingCreationFollow, setIsTogglingCreationFollow] = useState(false);
    const [activeMediaIndex, setActiveMediaIndex] = useState(0);
    const [hasAlreadyReported, setHasAlreadyReported] = useState(false);
    const [isStartingInstall, setIsStartingInstall] = useState(false);
    const [selectedClientId, setSelectedClientId] = useState('');

    // Streamer Tools: Overlay-QR-Zustand (lokal + remote) und OBS-Status
    const [overlayQrEntry, setOverlayQrEntry] = useState(() => readOverlayQr());
    const [selectedQrClientId, setSelectedQrClientId] = useState('');
    const [isSettingRemoteQr, setIsSettingRemoteQr] = useState(false);
    const [obsStatus, setObsStatus] = useState(null);
    const [showGoLiveModal, setShowGoLiveModal] = useState(false);
    const [isEndingLive, setIsEndingLive] = useState(false);
    const [, setLiveTick] = useState(0);

    useEffect(() => subscribeOverlayQr(setOverlayQrEntry), []);

    // OBS-Status vom Desktop-Client (Bridge existiert erst ab Client 1.0.23 —
    // ohne sie verhält sich die UI wie "OBS nicht verbunden").
    useEffect(() => {
        if (!window.electronAPI?.getObsStatus) return undefined;
        let cancelled = false;
        window.electronAPI.getObsStatus()
            .then((status) => { if (!cancelled) setObsStatus(status || null); })
            .catch(() => {});
        const unsubscribe = window.electronAPI.onObsStatusChanged?.((status) => setObsStatus(status || null));
        return () => {
            cancelled = true;
            if (typeof unsubscribe === 'function') unsubscribe();
        };
    }, []);

    // Live-Expiry neu bewerten, ohne dass ein Snapshot feuert: Minuten-Tick,
    // solange die Creation ein liveStream-Feld trägt.
    useEffect(() => {
        if (!creation?.liveStream) return undefined;
        const timer = setInterval(() => setLiveTick((n) => n + 1), 60 * 1000);
        return () => clearInterval(timer);
    }, [creation?.liveStream]);

    useEffect(() => {
        const clients = Object.entries(userProfile?.clients || {})
            .filter(([, client]) => client?.remoteInstall === true);
        setSelectedClientId((current) =>
            clients.some(([clientId]) => clientId === current) ? current : (clients[0]?.[0] || '')
        );
        setSelectedQrClientId((current) =>
            clients.some(([clientId]) => clientId === current) ? current : (clients[0]?.[0] || '')
        );
    }, [userProfile?.clients]);

    // Versuche Profil aus Cache zu laden
    const cachedProfile = cachedCreation?.userId
        ? queryClient.getQueryData(['profile', cachedCreation.userId])
        : null;
    const [creatorProfile, setCreatorProfile] = useState(cachedProfile || null);

    // Sekundäre Daten (laden im Hintergrund)
    const [communityDetails, setCommunityDetails] = useState([]);
    const [loadingCommunities, setLoadingCommunities] = useState(false);
    const [eventDetails, setEventDetails] = useState(null);
    const [userVote, setUserVote] = useState(null);
    const navigate = useNavigate();
    const functions = getFunctions();

    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        return new Date(timestamp.seconds * 1000).toLocaleDateString();
    };

    const getYoutubeThumbnail = (url) => getYoutubeThumbnailUrl(url);

    // View-Tracking: pro Browser-Session und Creation nur einmal zählen.
    // Die Rules erlauben genau dieses Feld als +1-Inkrement für jeden Besucher.
    useEffect(() => {
        if (!id) return;
        const viewKey = `viewed-${id}`;
        if (sessionStorage.getItem(viewKey)) return;
        sessionStorage.setItem(viewKey, '1');
        updateDoc(doc(db, 'creations', id), { views: increment(1) })
            .catch(() => sessionStorage.removeItem(viewKey));
    }, [id]);

    // Interessen-Signal (personalisierter Feed): Tags der angesehenen Creation,
    // 1× pro Session; No-op ohne Personalisierungs-Opt-in. Eigener Effekt,
    // weil die Tags erst mit dem geladenen Dokument verfügbar sind.
    useEffect(() => {
        if (!creation?.id || !creation.tags?.length) return;
        const trackKey = `tracked-${creation.id}`;
        if (sessionStorage.getItem(trackKey)) return;
        sessionStorage.setItem(trackKey, '1');
        recordView(creation.tags);
    }, [creation]);

    useEffect(() => {
        let isMounted = true;
        if (!id) {
            setLoadingCreation(false);
            return;
        }

        const docRef = doc(db, 'creations', id);
        const unsubscribe = onSnapshot(docRef, async (creationDoc) => {
            if (!isMounted) return;
            if (creationDoc.exists()) {
                const creationData = { id: creationDoc.id, ...creationDoc.data() };
                setCreation(creationData);

                // Parallele Datenabfragen starten
                const fetchPromises = [];

                // 1. Creator Profil - zuerst aus Cache prüfen
                if (creationData.userId) {
                    const cachedProfile = queryClient.getQueryData(['profile', creationData.userId]);
                    if (cachedProfile) {
                        setCreatorProfile(cachedProfile);
                    } else {
                        fetchPromises.push(
                            getDoc(doc(db, 'profiles', creationData.userId))
                                .then(snap => {
                                    if (isMounted && snap.exists()) {
                                        const profileData = snap.data();
                                        setCreatorProfile(profileData);
                                        // Im Cache speichern für zukünftige Nutzung
                                        queryClient.setQueryData(['profile', creationData.userId], profileData);
                                    }
                                })
                        );
                    }
                }

                // 2. Event Details
                if (creationData.eventIds && creationData.eventIds.length > 0) {
                    fetchPromises.push(
                        getDoc(doc(db, 'events', creationData.eventIds[0]))
                            .then(snap => {
                                if (isMounted) {
                                    setEventDetails(snap.exists() ? { id: snap.id, ...snap.data() } : null);
                                }
                            })
                    );
                } else {
                    setEventDetails(null);
                }

                // 3. Community Details (komplexer, aber auch parallel)
                if (creationData.communityIds && creationData.communityIds.length > 0) {
                    setLoadingCommunities(true);
                    fetchPromises.push(
                        (async () => {
                            const communityQuery = query(collection(db, 'communitys'), where(documentId(), 'in', creationData.communityIds));
                            const communitySnapshots = await getDocs(communityQuery);
                            const communitiesMap = new Map(communitySnapshots.docs.map(d => [d.id, { id: d.id, ...d.data() }]));

                            const detailsPromises = (creationData.communityAssignments || []).map(async (assignment) => {
                                const communityData = communitiesMap.get(assignment.communityId);
                                if (!communityData) return null;

                                const [memberSnap, linkSnap] = await Promise.all([
                                    getDoc(doc(db, 'communitys', assignment.communityId, 'members', creationData.userId)),
                                    getDoc(doc(db, 'communitys', assignment.communityId, 'creations', creationData.id))
                                ]);

                                if (memberSnap.exists()) {
                                    const memberData = memberSnap.data();
                                    const creatorRanks = (memberData.roles || []).map(roleName => {
                                        return (communityData.ranks || []).find(r => r.name.toLowerCase() === roleName.toLowerCase());
                                    }).filter(Boolean);

                                    return {
                                        communityId: assignment.communityId,
                                        communityName: communityData.name,
                                        communityProfileImageUrl: communityData.profileImageUrl,
                                        themeColor: communityData.themeColor,
                                        creatorRanksInCommunity: creatorRanks,
                                        customFieldsSchema: communityData.customCreationFields,
                                        customData: creationData.communitySpecificData?.[assignment.communityId],
                                        showcaseVideoUrl: linkSnap.exists() ? linkSnap.data().showcaseVideoUrl : null,
                                        slug: communityData.slug
                                    };
                                }
                                return null;
                            });
                            const resolvedDetails = (await Promise.all(detailsPromises)).filter(Boolean);
                            if (isMounted) {
                                setCommunityDetails(resolvedDetails);
                                setLoadingCommunities(false);
                            }
                        })()
                    );
                }

                // Alle parallelen Anfragen abwarten
                await Promise.all(fetchPromises);

                const videoCount = creationData.videoUrls?.length || 0;
                const imageCount = creationData.imageUrls?.length || 0;
                const hasActiveLiveStream = isLiveStreamActive(creationData.liveStream) && creationData.liveStream?.url;
                // Galerie-Reihenfolge: Videos → Live → Bilder. Normal startet
                // sie beim ersten Bild, während LIVE gezielt beim Stream startet.
                const initialIndex = hasActiveLiveStream ? videoCount : (imageCount > 0 ? videoCount : 0);
                if (isMounted) setActiveMediaIndex(initialIndex);

            } else {
                // Aufräumen, falls diese Creation gerade im Overlay-QR oder als
                // Live-Session dieses Clients hing und gelöscht wurde.
                if (readOverlayQr()?.creationId === id) setOverlayQr(null);
                if (readLiveSession()?.creationId === id) setLiveSession(null);
                setModalMessage("Creation not found.");
                if (!creationIdOverride) navigate('/');
            }
            if (isMounted) setLoadingCreation(false);
        });

        return () => { isMounted = false; unsubscribe(); };
    }, [id, navigate, setModalMessage, creationIdOverride, queryClient]);
    
    useEffect(() => {
        if (!user || !id || !creation) return;
        let isMounted = true;
        
        if (userProfile?.following) {
            setIsFollowing(userProfile.following.includes(creation.userId));
        }

        const voteRef = doc(db, 'creations', id, 'votes', user.uid);
        const unsubVote = onSnapshot(voteRef, (doc) => {
            if (isMounted) setUserVote(doc.exists() ? doc.data().type : null);
        });

        const checkReportStatus = async () => {
            const reportMarkerRef = doc(db, 'users', user.uid, 'reportedItems', id);
            const docSnap = await getDoc(reportMarkerRef);
            if (isMounted) setHasAlreadyReported(docSnap.exists());
        };
        checkReportStatus();

        // Am I following this creation? (creationFollowers/{id}/followers/{uid})
        getDoc(doc(db, 'creationFollowers', id, 'followers', user.uid))
            .then(snap => { if (isMounted) setIsFollowingCreation(snap.exists()); })
            .catch(() => {});

        return () => { isMounted = false; unsubVote(); };
    }, [id, user, userProfile, creation]);

    const handleShare = async () => {
        const shareData = {
            title: `PlanetCreations: ${creation.title}`,
            text: `Check out "${creation.title}" by ${creatorProfile?.username || creation.username} on PlanetCreations!`,
            url: window.location.origin + `/#/creation/${id}`,
        };
        try {
            if (navigator.share) {
                await navigator.share(shareData);
            } else {
                await navigator.clipboard.writeText(shareData.url);
                setModalMessage("Link copied to clipboard!");
            }
        } catch (error) {
            if (error.name !== 'AbortError') setModalMessage('Could not share at this time.');
        }
    };

    const handleVote = async (newVoteType) => {
        if (!user || isVoting) return;
        setIsVoting(true);
        const voteOnCreation = httpsCallable(functions, 'voteOnCreation');
        try {
            await voteOnCreation({ creationId: id, voteType: newVoteType });
            if (newVoteType === 'like') {
                recordVote(creation?.tags || [], 'like'); // Interessen-Signal (No-op ohne Opt-in)
            }
        } catch (error) {
            setModalMessage(`An error occurred: ${error.message}`);
        } finally {
            setIsVoting(false);
        }
    };
    
    const handleDelete = () => {
        setConfirmation({
            message: "Are you sure you want to delete this creation? This action cannot be undone.",
            onConfirm: async () => {
                try {
                    await deleteDoc(doc(db, 'creations', id));
                    setModalMessage("Creation deleted successfully.");
                    scheduleDataRefresh();
                    navigate('/');
                } catch (error) {
                    setModalMessage(`Error: ${error.message}`);
                }
            }
        });
    };

    // Follow the CREATION itself (creationFollowers/{id}/followers/{uid}) to get
    // notified of changelog updates. Separate from following the creator (above).
    const handleFollowCreation = async () => {
        if (!user) { setModalMessage("You must be logged in to follow a creation."); return; }
        if (isTogglingCreationFollow) return;
        setIsTogglingCreationFollow(true);
        const followRef = doc(db, 'creationFollowers', id, 'followers', user.uid);
        try {
            if (isFollowingCreation) {
                await deleteDoc(followRef);
                setIsFollowingCreation(false);
            } else {
                await setDoc(followRef, { userId: user.uid, followedAt: serverTimestamp() });
                setIsFollowingCreation(true);
            }
        } catch (error) {
            setModalMessage(`Error updating follow: ${error.message}`);
        } finally {
            setIsTogglingCreationFollow(false);
        }
    };

    const handleFollow = async () => {
        if (!user || !userProfile || isVoting || !creation) return;
        if (user.uid === creation.userId) return;
        setIsVoting(true);
        const currentUserRef = doc(db, 'profiles', user.uid);
        const targetUserRef = doc(db, 'profiles', creation.userId);
        const batch = writeBatch(db);
        const currentlyFollowing = isFollowing;
        try {
            if (currentlyFollowing) {
                // arrayRemove statt read-modify-write: kein Clobbering bei parallelen Änderungen
                batch.update(currentUserRef, { following: arrayRemove(creation.userId) });
                batch.update(targetUserRef, { followers: arrayRemove(user.uid) });
            } else {
                batch.update(currentUserRef, { following: arrayUnion(creation.userId) });
                batch.update(targetUserRef, { followers: arrayUnion(user.uid) });
            }
            await batch.commit();
            setIsFollowing(!currentlyFollowing);
        } catch (error) {
            setModalMessage(`Error following user: ${error.message}`);
        } finally {
            setIsVoting(false);
        }
    };

    const handleCopyShareCode = () => {
        if (creation?.shareCode) {
            navigator.clipboard.writeText(creation.shareCode);
            setModalMessage("Share code copied to clipboard!");
        }
    };

    const handleReport = () => {
        if (!user) { setModalMessage("You must be logged in to report content."); return; }
        if (hasAlreadyReported) { setModalMessage("You have already reported this creation."); return; }
        setReportModal({
            targetId: id,
            targetType: 'creation',
            targetTitle: creation.title,
            onConfirm: async (reason) => {
                try {
                    const batch = writeBatch(db);
                    const reportRef = doc(collection(db, 'reports'));
                    batch.set(reportRef, { targetId: id, targetType: 'creation', targetTitle: creation.title, reason, reporterId: user.uid, timestamp: serverTimestamp() });
                    const reportMarkerRef = doc(db, 'users', user.uid, 'reportedItems', id);
                    batch.set(reportMarkerRef, { reportedAt: serverTimestamp() });
                    // reportCount wird serverseitig vom onReportCreated-Trigger erhöht.
                    await batch.commit();
                    setHasAlreadyReported(true);
                    setModalMessage("Creation reported successfully. Our team will review it.");
                } catch (error) {
                    setModalMessage(`Error submitting report: ${error.message}`);
                }
            }
        });
    };

    // Zeige Spinner nur wenn noch keine gecachte Creation vorhanden ist
    if (loadingCreation && !creation) return <Spinner gameId={creation?.game} />;
    if (!creation) return null;

    const isOwner = user && user.uid === creation.userId;
    const canEdit = isOwner;
    const canDelete = isOwner || (userProfile && ['admin', 'moderator'].includes(userProfile.role));
    const color = getGameColor(creation.game);
    const liveStream = creation.liveStream;
    const liveIsActive = isLiveStreamActive(liveStream);
    const liveMedia = liveIsActive && liveStream?.url ? {
        type: 'live',
        url: liveStream.url,
        platform: liveStream.platform,
    } : null;
    const mediaItems = [
        ...(creation.videoUrls || []).map((url) => ({ type: 'video', url })),
        ...(liveMedia ? [liveMedia] : []),
        ...(creation.imageUrls || []).map((url) => ({ type: 'image', url })),
    ];
    const activeMedia = mediaItems[activeMediaIndex];
    const sortedChangelog = creation.changelog ? [...creation.changelog].sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)) : [];
    const displayUsername = creatorProfile?.username || creation.username;
    const displayProfilePic = creatorProfile?.profilePictureUrl;
    const eventSubmissions = eventDetails ? creation.eventSubmissions?.[eventDetails.id] : null;

    const isYoutube = (url) => url && (url.includes('youtube.com') || url.includes('youtu.be'));
    const getYoutubeEmbedUrl = (url) => getYoutubeEmbed(url);
    const isMobilePlayback = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches;
    const getLiveEmbedUrl = (stream) => {
        if (!stream?.url) return null;
        const autoplay = isMobilePlayback ? '0' : '1';
        const muted = isMobilePlayback ? 'false' : 'true';
        if (stream.platform === 'youtube') {
            const baseUrl = getYoutubeEmbed(stream.url);
            if (!baseUrl) return null;
            return `${baseUrl}?autoplay=${autoplay}&mute=${isMobilePlayback ? '0' : '1'}&playsinline=1&origin=${encodeURIComponent(window.location.origin)}`;
        }
        if (stream.platform === 'twitch') {
            try {
                const channel = new URL(stream.url).pathname.split('/').filter(Boolean)[0];
                if (!channel) return null;
                const parent = window.location.hostname || 'planetcreations.net';
                return `https://player.twitch.tv/?channel=${encodeURIComponent(channel)}&parent=${encodeURIComponent(parent)}&autoplay=${autoplay}&muted=${muted}`;
            } catch (error) {
                return null;
            }
        }
        return null;
    };

    const showcaseVideos = [];
    if (creation.assignedVideoUrl) {
        showcaseVideos.push({
            type: 'Event',
            sourceName: eventDetails?.title || 'Event',
            url: creation.assignedVideoUrl,
            link: `/event/${eventDetails?.id}`
        });
    }
    communityDetails.forEach(comm => {
        if (comm.showcaseVideoUrl) {
            showcaseVideos.push({
                type: 'Community',
                sourceName: comm.communityName,
                url: comm.showcaseVideoUrl,
                link: `/community/${comm.slug}` 
            });
        }
    });

    const nextMedia = () => setActiveMediaIndex((prev) => (prev + 1) % mediaItems.length);
    const prevMedia = () => setActiveMediaIndex((prev) => (prev - 1 + mediaItems.length) % mediaItems.length);

    const isElectron = window.electronAPI?.isElectron;
    const compatibleClients = Object.entries(userProfile?.clients || {})
        .filter(([, client]) => client?.remoteInstall === true);
    const selectedClient = compatibleClients.find(([clientId]) => clientId === selectedClientId)?.[1];
    const hasDownloadableBackup = Boolean(creation.backupObjectKey);
    const canDirectInstall = Boolean(user && hasDownloadableBackup && (isElectron || compatibleClients.length > 0));

    const handleDirectInstall = async () => {
        if (!user || isStartingInstall) return;
        setIsStartingInstall(true);
        try {
            if (isElectron) {
                const getBackupDownloadUrl = httpsCallable(functions, 'getBackupDownloadUrl');
                const response = await getBackupDownloadUrl({ creationId: id });
                const installResult = await window.electronAPI.installQueuedCreation({
                    creationId: id,
                    downloadUrl: response.data.downloadUrl,
                    title: creation.title,
                    previewUrl: creation.imageUrls?.[0] || '',
                });
                if (!installResult?.success) throw new Error(installResult?.message || 'The creation could not be installed.');
                setModalMessage(`Successfully installed '${installResult.installedFileName}'.`);
            } else {
                if (!selectedClientId) throw new Error('No compatible desktop client is registered.');
                const enqueueClientInstall = httpsCallable(functions, 'enqueueClientInstall');
                const response = await enqueueClientInstall({ creationId: id, clientId: selectedClientId });
                setModalMessage(response.data?.duplicate ?
                    `This creation is already queued for ${selectedClient?.displayName || 'the selected client'}.` :
                    `Direct install queued for ${selectedClient?.displayName || 'the selected client'}.`);
            }
        } catch (error) {
            console.error('Could not start direct install:', error);
            setModalMessage(`Direct install could not be started: ${error.message}`);
        } finally {
            setIsStartingInstall(false);
        }
    };

    // --- Streamer Tools (Owner) + Live-Anzeige (alle Besucher) ---
    const livePlatformLabel = LIVE_PLATFORMS[liveStream?.platform]?.label || 'stream';
    const qrActiveForThis = overlayQrEntry?.creationId === id;
    const obsConnected = Boolean(obsStatus?.connected);
    const obsStreaming = Boolean(obsStatus?.streaming);
    const liveSession = readLiveSession();

    const formatTime = (timestamp) => {
        const ms = timestamp?.toMillis?.() || (timestamp?.seconds ? timestamp.seconds * 1000 : null);
        return ms ? new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
    };

    const handleToggleLocalQr = () => {
        if (qrActiveForThis) {
            setOverlayQr(null);
        } else {
            setOverlayQr({
                creationId: id,
                title: creation.title,
                url: buildCreationShareUrl(id),
                source: 'manual',
                enabledAt: Date.now(),
            });
        }
    };

    const handleRemoteQr = async (clear) => {
        if (!selectedQrClientId || isSettingRemoteQr) return;
        setIsSettingRemoteQr(true);
        try {
            const setClientOverlayQr = httpsCallable(functions, 'setClientOverlayQr');
            await setClientOverlayQr({
                clientId: selectedQrClientId,
                entry: clear ? null : { creationId: id, title: creation.title },
            });
            const clientName = compatibleClients.find(([cid]) => cid === selectedQrClientId)?.[1]?.displayName || 'the selected client';
            setModalMessage(clear
                ? `Overlay QR cleared on ${clientName}.`
                : `Overlay now shows this creation's QR on ${clientName}.`);
        } catch (error) {
            setModalMessage(`Could not update the remote overlay: ${error.message}`);
        } finally {
            setIsSettingRemoteQr(false);
        }
    };

    const handleEndLive = () => {
        setConfirmation({
            message: liveIsActive
                ? 'End your live session? The LIVE badge will be removed for all viewers.'
                : 'Clear the expired live session from this creation?',
            onConfirm: async () => {
                setIsEndingLive(true);
                try {
                    const endLive = httpsCallable(functions, 'endLive');
                    await endLive({ creationId: id });
                    if (readLiveSession()?.creationId === id) setLiveSession(null);
                    if (readOverlayQr()?.creationId === id) setOverlayQr(null);
                } catch (error) {
                    setModalMessage(`Could not end the live session: ${error.message}`);
                } finally {
                    setIsEndingLive(false);
                }
            },
        });
    };

    return (
        <div className="container mx-auto mt-8 p-4" style={color.style}>
            <div className="flex justify-between items-center mb-4">
                <button onClick={() => navigate(-1)} className={`flex items-center justify-center ${color.bg} ${color.hoverBg} text-white px-4 py-2 rounded-md transition-colors font-semibold`}>
                    <Icon path={ICONS.arrowLeft} className="w-5 h-5 mr-2"/> Back
                </button>
                <div className="flex items-center space-x-2">
                    <button onClick={handleShare} title="Share Creation" className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"><Icon path={ICONS.share} className="w-6 h-6" /></button>
                    {user && (<button onClick={handleFollowCreation} disabled={isTogglingCreationFollow} title={isFollowingCreation ? "Following this creation — you'll be notified of updates" : "Follow this creation to get notified of updates"} className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors disabled:opacity-50 ${isFollowingCreation ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'}`}><Icon path={ICONS.bell} className="w-6 h-6" solid={isFollowingCreation} /></button>)}
                    {user && user.uid !== creation.userId && (<button onClick={handleFollow} title={isFollowing ? "Unfollow Creator" : "Follow Creator"} className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors ${isFollowing ? 'bg-blue-500 text-white' : 'bg-gray-200 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'}`}><Icon path={ICONS.userAdd} className="w-6 h-6" solid={isFollowing} /></button>)}
                    {canEdit && (<Link to={`/creation/${id}/edit`} className="flex items-center justify-center w-10 h-10 bg-yellow-500 hover:bg-yellow-600 text-white rounded-full transition-colors"><Icon path={ICONS.edit} className="w-5 h-5" solid/></Link>)}
                    {canDelete && (<button onClick={handleDelete} className="flex items-center justify-center w-10 h-10 bg-red-500 hover:bg-red-600 text-white rounded-full transition-colors"><Icon path={ICONS.trash} className="w-5 h-5" solid/></button>)}
                </div>
            </div>
            <h2 className="text-4xl font-bold mb-6 text-center">{creation.title}</h2>

            {liveIsActive && (
                <div className="mb-6 rounded-lg bg-red-600 text-white shadow-md p-3 sm:p-4 flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-4 text-center">
                    <span className="flex items-center gap-2 font-bold">
                        <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-white"></span>
                        </span>
                        LIVE
                    </span>
                    <span className="text-sm sm:text-base">{displayUsername} is building this live on {livePlatformLabel}</span>
                    {liveStream?.url && (
                        <button
                            onClick={() => setExternalLink(liveStream.url)}
                            className="bg-white text-red-600 font-bold px-4 py-1.5 rounded-full hover:bg-red-50 transition-colors text-sm"
                        >
                            Watch stream
                        </button>
                    )}
                </div>
            )}

            <div className="flex flex-col lg:flex-row gap-8">
                <div className="w-full lg:w-2/3">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden">
                        <div className="bg-black flex justify-center items-center aspect-video relative group">
                            {activeMedia?.type === 'live' && getLiveEmbedUrl(activeMedia) ? (
                                <iframe src={getLiveEmbedUrl(activeMedia)} title={`${livePlatformLabel} live stream`} frameBorder="0" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowFullScreen className="w-full h-full"></iframe>
                            ) : activeMedia && isYoutube(activeMedia.url) ? (
                                <iframe src={getYoutubeEmbedUrl(activeMedia.url)} title="YouTube video player" frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen className="w-full h-full"></iframe>
                            ) : (
                                <img src={activeMedia?.url} alt="Creation preview" className="max-h-[60vh] object-contain" onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/800x450/333333/ffffff?text=Not+found'; }}/>
                            )}
                            {mediaItems.length > 1 && (<>
                                <button onClick={prevMedia} className="absolute left-2 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><Icon path={ICONS.chevronLeft} /></button>
                                <button onClick={nextMedia} className="absolute right-2 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><Icon path={ICONS.chevronRight} /></button>
                            </>)}
                        </div>
                        {mediaItems.length > 1 && (
                            <div className="flex p-2 bg-gray-100 dark:bg-gray-700 overflow-x-auto">
                                {mediaItems.map((item, index) => (
                                    <button key={`${item.type}-${item.url}-${index}`} onClick={() => setActiveMediaIndex(index)} className={`w-24 h-16 flex-shrink-0 mx-1 rounded-md overflow-hidden border-2 ${activeMediaIndex === index ? color.border : 'border-transparent'}`}>
                                        {item.type === 'live' ? (
                                            <span className={`w-full h-full flex flex-col items-center justify-center gap-1 text-white ${item.platform === 'twitch' ? 'bg-purple-700' : 'bg-red-600'}`}>
                                                <Icon path={item.platform === 'twitch' ? ICONS.twitch : ICONS.youtube} className="w-5 h-5" solid />
                                                <span className="text-xs font-extrabold tracking-wide">LIVE</span>
                                            </span>
                                        ) : isYoutube(item.url) ? (<img src={getYoutubeThumbnail(item.url)} alt={`Thumbnail ${index + 1}`} className="w-full h-full object-cover" />) : (<img src={item.url} alt={`Thumbnail ${index + 1}`} className="w-full h-full object-cover" />)}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mt-8">
                        <h3 className="text-2xl font-bold mb-4 text-center">Description</h3>
                        <p className="text-gray-800 dark:text-gray-200 whitespace-pre-wrap text-center">{creation.description}</p>
                    </div>

                    {showcaseVideos.length > 0 && (
                        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mt-8">
                            <h3 className="text-2xl font-bold mb-4 text-center">Showcase</h3>
                            <div className="flex overflow-x-auto space-x-4 pb-2">
                                {showcaseVideos.map((video, index) => (
                                    <a key={index} href={video.url} target="_blank" rel="noopener noreferrer" className="block w-48 flex-shrink-0 group">
                                        <div className="relative">
                                            <img src={getYoutubeThumbnail(video.url)} alt={`Showcase from ${video.sourceName}`} className="w-full h-28 object-cover rounded-lg shadow-md" />
                                            <div className="absolute inset-0 bg-black bg-opacity-40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                                                <Icon path={ICONS.video} className="w-10 h-10 text-white" />
                                            </div>
                                        </div>
                                        <p className="text-sm font-semibold mt-2">Showcased by <Link to={video.link} className={`${color.text} hover:underline`}>{video.sourceName}</Link></p>
                                    </a>
                                ))}
                            </div>
                        </div>
                    )}

                    {sortedChangelog.length > 0 && (
                        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mt-8">
                            <h3 className="text-2xl font-bold mb-4 text-center">Changelog</h3>
                            <div className="h-48 overflow-y-auto pr-2 space-y-4 text-center">
                                {sortedChangelog.map((entry, index) => (
                                    <div key={index} className="pb-4 border-b last:border-b-0">
                                        <p className="font-semibold text-gray-800 dark:text-gray-100">{entry.text}</p>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{formatDate(entry.timestamp)}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {eventDetails && eventSubmissions && (
                        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 mt-8">
                            <h3 className="text-2xl font-bold mb-4 text-center">
                                Event Specific Information for <Link to={`/event/${eventDetails.id}`} className="text-blue-500 hover:underline">{eventDetails.title}</Link>
                            </h3>
                            <div className="space-y-4">
                                {eventDetails.customFields?.map(field => (
                                    <div key={field.id}>
                                        <p className="font-semibold text-gray-700 dark:text-gray-200">{field.label}</p>
                                        <p className="text-gray-600 dark:text-gray-300 pl-2 border-l-2 dark:border-gray-600 ml-2">{eventSubmissions[field.id] || "No answer provided."}</p>
                                    </div>
                                ))}
                                {(!eventDetails.customFields || eventDetails.customFields.length === 0) && (
                                    <p className="text-gray-500">This event had no custom fields.</p>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div className="w-full lg:w-1/3 space-y-8">
                    <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6">
                        <Link to={`/profile/${creation.userId}`} className="flex flex-col items-center text-center mb-4 cursor-pointer">
                            {creatorProfile ? (
                                <>
                                    <p className="text-sm text-gray-500 mb-2">Creator</p>
                                    <div className="relative mb-2">
                                        <img src={displayProfilePic || 'https://placehold.co/64x64/e2e8f0/64748b?text=P'} alt="Creator profile" className="w-16 h-16 rounded-full object-cover"/>
                                        {liveIsActive && (
                                            <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 bg-red-600 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wide ring-2 ring-white dark:ring-gray-800">Live</span>
                                        )}
                                    </div>
                                    <span className={`text-xl font-bold ${color.text} hover:underline`}>{displayUsername}</span>
                                </>
                            ) : (
                                <>
                                    <p className="text-sm text-gray-500 mb-2">Creator</p>
                                    <div className="w-16 h-16 rounded-full bg-gray-200 animate-pulse mb-2"></div>
                                    <div className="h-6 w-32 bg-gray-200 rounded animate-pulse"></div>
                                </>
                            )}
                        </Link>
                        <div className="mt-6 pt-6 border-t dark:border-gray-700 text-sm text-gray-600 dark:text-gray-300 space-y-4">
                            <div className="flex items-center justify-between"><span className="font-bold">Status:</span><span className={`px-2 py-1 rounded-full font-semibold text-xs ${creation.status === 'finished' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}`}>{creation.status === 'finished' ? 'Finished' : 'Work in Progress'}</span></div>
                            <div className="flex items-center justify-between"><span className="font-bold">Rating:</span><div className="flex items-center space-x-4"><button onClick={() => handleVote('like')} disabled={isVoting || !user} className={`flex items-center space-x-1 transition-colors ${userVote === 'like' ? 'text-green-500' : 'text-gray-400 hover:text-green-500'}`}><Icon path={ICONS.thumbUp} className="w-5 h-5" solid={userVote === 'like'}/><span className="font-bold">{creation.likes || 0}</span></button><button onClick={() => handleVote('dislike')} disabled={isVoting || !user} className={`flex items-center space-x-1 transition-colors ${userVote === 'dislike' ? 'text-red-500' : 'text-gray-400 hover:text-red-500'}`}><Icon path={ICONS.thumbDown} className="w-5 h-5" solid={userVote === 'dislike'}/><span className="font-bold">{creation.dislikes || 0}</span></button></div></div>
                            <div className="flex items-center justify-between"><span className="font-bold">Views:</span><span className="flex items-center space-x-1"><Icon path={ICONS.eye} className="w-5 h-5 text-gray-400"/><span className="font-bold">{creation.views || 0}</span></span></div>
                            <div className="flex items-center justify-between"><span className="font-bold">Created:</span><span>{formatDate(creation.createdAt)}</span></div>
                            <div className="flex items-center justify-between"><span className="font-bold">Updated:</span><span>{formatDate(creation.updatedAt)}</span></div>
                            <button onClick={handleReport} disabled={hasAlreadyReported} className="w-full flex items-center justify-center space-x-2 text-gray-500 hover:text-red-500 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors pt-4 border-t mt-4"><Icon path={ICONS.flag} className="w-5 h-5"/><span>{hasAlreadyReported ? 'Already Reported' : 'Report Creation'}</span></button>
                        </div>
                        
                        <div className="mt-6 pt-6 border-t space-y-4">
                            {creation.shareCode && (
                                <div>
                                    <p className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-1 text-center">Share Code</p>
                                    <button onClick={handleCopyShareCode} className="w-full font-mono bg-gray-100 dark:bg-gray-700 dark:text-gray-100 p-2 rounded text-center hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">{creation.shareCode}</button>
                                </div>
                            )}

                            {canDirectInstall && (
                                <div>
                                    <p className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-1 text-center">Direct Install</p>
                                    {!isElectron && compatibleClients.length > 1 && (
                                        <select
                                            value={selectedClientId}
                                            onChange={(event) => setSelectedClientId(event.target.value)}
                                            className="w-full mb-2 p-2 border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                                            aria-label="Direct install target"
                                        >
                                            {compatibleClients.map(([clientId, client]) => (
                                                <option key={clientId} value={clientId}>{client.displayName || 'Windows PC'}</option>
                                            ))}
                                        </select>
                                    )}
                                    <button type="button" onClick={handleDirectInstall} disabled={isStartingInstall} className={`w-full flex items-center justify-center gap-2 p-3 rounded-lg font-semibold text-white transition-colors disabled:opacity-60 ${color.bg} ${color.hoverBg}`}>
                                        <Icon path={ICONS.download} className="w-5 h-5" />
                                        {isStartingInstall ? 'Preparing Direct Install...' :
                                            (isElectron ? 'Direct Install' : `Direct Install on ${selectedClient?.displayName || 'Client'}`)}
                                    </button>
                                </div>
                            )}
                        </div>
                        
                        {creation.customMediaLink && (
                            <div className="mt-4">
                                <p className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-2 text-center">Custom Media</p>
                                <button type="button" onClick={() => setExternalLink(creation.customMediaLink)} className="w-full flex items-center justify-center gap-2 p-3 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold transition-colors">
                                    <Icon path={ICONS.download} className="w-5 h-5" />
                                    Download Custom Media
                                </button>
                            </div>
                        )}
                        <CreationSharingQrCode creationId={id} creationName={creation.title} />
                        {isOwner && (
                            <div className="mt-6 pt-6 border-t dark:border-gray-700 space-y-4">
                                <p className="text-sm font-bold text-gray-600 dark:text-gray-300 text-center">Streamer Tools</p>

                                {isElectron && (
                                    <div>
                                        <button
                                            type="button"
                                            onClick={handleToggleLocalQr}
                                            className={`w-full flex items-center justify-center gap-2 p-3 rounded-lg font-semibold transition-colors ${qrActiveForThis
                                                ? 'bg-gray-200 hover:bg-gray-300 text-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-100'
                                                : `text-white ${color.bg} ${color.hoverBg}`}`}
                                        >
                                            <Icon path={ICONS.share} className="w-5 h-5" />
                                            {qrActiveForThis ? 'Stop showing QR in overlay' : 'Show QR in game overlay'}
                                        </button>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
                                            Replaces the overlay logo with this creation's QR code so viewers can scan it on stream. Tip: hold and scroll on the overlay icon to enlarge it.
                                        </p>
                                        {overlayQrEntry && !qrActiveForThis && (
                                            <p className="text-xs text-orange-500 mt-1 text-center">
                                                The overlay currently shows the QR of another creation — enabling it here will replace it.
                                            </p>
                                        )}
                                    </div>
                                )}

                                {compatibleClients.length > 0 && (
                                    <div>
                                        {compatibleClients.length > 1 && (
                                            <select
                                                value={selectedQrClientId}
                                                onChange={(event) => setSelectedQrClientId(event.target.value)}
                                                className="w-full mb-2 p-2 border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-100"
                                                aria-label="Overlay QR target client"
                                            >
                                                {compatibleClients.map(([clientId, client]) => (
                                                    <option key={clientId} value={clientId}>{client.displayName || 'Windows PC'}</option>
                                                ))}
                                            </select>
                                        )}
                                        <div className="flex gap-2">
                                            <button
                                                type="button"
                                                onClick={() => handleRemoteQr(false)}
                                                disabled={isSettingRemoteQr}
                                                className="flex-1 flex items-center justify-center gap-2 p-3 rounded-lg font-semibold bg-gray-200 hover:bg-gray-300 text-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-100 transition-colors disabled:opacity-60"
                                            >
                                                <Icon path={ICONS.desktop} className="w-5 h-5" />
                                                Show QR remotely
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleRemoteQr(true)}
                                                disabled={isSettingRemoteQr}
                                                className="p-3 rounded-lg font-semibold bg-gray-200 hover:bg-gray-300 text-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-100 transition-colors disabled:opacity-60"
                                                title="Clear the overlay QR on the selected client"
                                            >
                                                <Icon path={ICONS.xMark} className="w-5 h-5" />
                                            </button>
                                        </div>
                                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 text-center">
                                            Sends this creation's QR to the game overlay of {compatibleClients.length > 1 ? 'the selected' : 'your'} desktop client.
                                        </p>
                                    </div>
                                )}

                                <div>
                                    {liveStream ? (
                                        <div>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2 text-center">
                                                {liveIsActive
                                                    ? `Live on ${livePlatformLabel}${formatTime(liveStream.startedAt) ? ` since ${formatTime(liveStream.startedAt)}` : ''} — ends automatically with your stream.`
                                                    : 'The last live session expired without being ended.'}
                                            </p>
                                            <button
                                                type="button"
                                                onClick={handleEndLive}
                                                disabled={isEndingLive}
                                                className="w-full flex items-center justify-center gap-2 p-3 rounded-lg font-semibold bg-gray-200 hover:bg-gray-300 text-gray-800 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-100 transition-colors disabled:opacity-60"
                                            >
                                                <Icon path={ICONS.video} className="w-5 h-5" />
                                                {liveIsActive ? 'End live now' : 'Clear expired live session'}
                                            </button>
                                        </div>
                                    ) : !isElectron ? (
                                        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                                            Live mode requires the desktop client with OBS or Streamlabs connected.
                                        </p>
                                    ) : !obsConnected ? (
                                        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                                            Connect OBS or Streamlabs in the client's Streaming settings to go live.
                                        </p>
                                    ) : !obsStreaming ? (
                                        <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
                                            Start your stream to go live with this creation.
                                        </p>
                                    ) : (
                                        <button
                                            type="button"
                                            onClick={() => setShowGoLiveModal(true)}
                                            className="w-full flex items-center justify-center gap-2 p-3 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700 transition-colors"
                                        >
                                            <Icon path={ICONS.video} className="w-5 h-5" />
                                            Link this creation to your stream
                                        </button>
                                    )}
                                    {liveSession && liveSession.creationId !== id && !liveStream && (
                                        <p className="text-xs text-orange-500 mt-1 text-center">
                                            You are currently live with another creation — going live here will move the LIVE badge.
                                        </p>
                                    )}
                                </div>
                            </div>
                        )}
                        <div className="mt-6 pt-6 border-t"><p className="text-sm font-bold text-gray-600 dark:text-gray-300 mb-2 text-center">Tags</p><div className="flex flex-wrap gap-2">{creation.tags?.map(tag => (<button key={tag} onClick={() => navigate(`/?game=${creation.game}&tag=${encodeURIComponent(tag)}`)} className="bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 text-sm font-semibold px-2.5 py-1 rounded-full hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors cursor-pointer">{tag}</button>))}</div></div>
                    </div>
                    {loadingCommunities ? (
                        <div className="bg-white dark:bg-gray-800 rounded-lg shadow-md p-6 animate-pulse">
                            <div className="h-6 bg-gray-200 rounded w-1/2 mb-4"></div>
                            <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                        </div>
                    ) : communityDetails.length > 0 && (
                        <div className="space-y-4">{communityDetails.map(communityInfo => (<CommunityInfoCard key={communityInfo.communityId} communityInfo={communityInfo} setModalMessage={setModalMessage} />))}</div>
                    )}
                </div>
            </div>
            {showGoLiveModal && (
                <GoLiveModal
                    user={user}
                    userProfile={userProfile}
                    isElectron={isElectron}
                    obsService={obsStatus?.service || null}
                    initialCreation={creation}
                    onClose={() => setShowGoLiveModal(false)}
                    setModalMessage={setModalMessage}
                />
            )}
        </div>
    );
};

export default CreationDetail;
