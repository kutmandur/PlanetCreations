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
                const initialIndex = imageCount > 0 ? videoCount : 0;
                if (isMounted) setActiveMediaIndex(initialIndex);

            } else {
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
    const mediaItems = [...(creation.videoUrls || []), ...(creation.imageUrls || [])];
    const activeMedia = mediaItems[activeMediaIndex];
    const sortedChangelog = creation.changelog ? [...creation.changelog].sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0)) : [];
    const displayUsername = creatorProfile?.username || creation.username;
    const displayProfilePic = creatorProfile?.profilePictureUrl;
    const eventSubmissions = eventDetails ? creation.eventSubmissions?.[eventDetails.id] : null;

    const isYoutube = (url) => url && (url.includes('youtube.com') || url.includes('youtu.be'));
    const getYoutubeEmbedUrl = (url) => getYoutubeEmbed(url);

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
    const originBackupUrl = creation.backupUrl;
    const directImportUrl = originBackupUrl ? `planetcreations://import?url=${encodeURIComponent(originBackupUrl)}` : null;


    return (
        <div className="container mx-auto mt-8 p-4">
            <div className="flex justify-between items-center mb-4">
                <button onClick={() => navigate(-1)} className={`flex items-center justify-center ${color.bg} ${color.hoverBg} text-white px-4 py-2 rounded-md transition-colors font-semibold`}>
                    <Icon path={ICONS.arrowLeft} className="w-5 h-5 mr-2"/> Back
                </button>
                <div className="flex items-center space-x-2">
                    <button onClick={handleShare} title="Share Creation" className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors"><Icon path={ICONS.share} className="w-6 h-6" /></button>
                    {user && (<button onClick={handleFollowCreation} disabled={isTogglingCreationFollow} title={isFollowingCreation ? "Following this creation — you'll be notified of updates" : "Follow this creation to get notified of updates"} className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors disabled:opacity-50 ${isFollowingCreation ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}><Icon path={ICONS.bell} className="w-6 h-6" solid={isFollowingCreation} /></button>)}
                    {user && user.uid !== creation.userId && (<button onClick={handleFollow} title={isFollowing ? "Unfollow Creator" : "Follow Creator"} className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors ${isFollowing ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}><Icon path={ICONS.userAdd} className="w-6 h-6" solid={isFollowing} /></button>)}
                    {canEdit && (<Link to={`/creation/${id}/edit`} className="flex items-center justify-center w-10 h-10 bg-yellow-500 hover:bg-yellow-600 text-white rounded-full transition-colors"><Icon path={ICONS.edit} className="w-5 h-5" solid/></Link>)}
                    {canDelete && (<button onClick={handleDelete} className="flex items-center justify-center w-10 h-10 bg-red-500 hover:bg-red-600 text-white rounded-full transition-colors"><Icon path={ICONS.trash} className="w-5 h-5" solid/></button>)}
                </div>
            </div>
            <h2 className="text-4xl font-bold mb-6 text-center">{creation.title}</h2>
            
            <div className="flex flex-col lg:flex-row gap-8">
                <div className="w-full lg:w-2/3">
                    <div className="bg-white rounded-lg shadow-lg overflow-hidden">
                        <div className="bg-black flex justify-center items-center aspect-video relative group">
                            {activeMedia && isYoutube(activeMedia) ? (
                                <iframe src={getYoutubeEmbedUrl(activeMedia)} title="YouTube video player" frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen className="w-full h-full"></iframe>
                            ) : (
                                <img src={activeMedia} alt="Creation preview" className="max-h-[60vh] object-contain" onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/800x450/333333/ffffff?text=Not+found'; }}/>
                            )}
                            {mediaItems.length > 1 && (<>
                                <button onClick={prevMedia} className="absolute left-2 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><Icon path={ICONS.chevronLeft} /></button>
                                <button onClick={nextMedia} className="absolute right-2 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><Icon path={ICONS.chevronRight} /></button>
                            </>)}
                        </div>
                        {mediaItems.length > 1 && (
                            <div className="flex p-2 bg-gray-100 overflow-x-auto">
                                {mediaItems.map((item, index) => (
                                    <button key={index} onClick={() => setActiveMediaIndex(index)} className={`w-24 h-16 flex-shrink-0 mx-1 rounded-md overflow-hidden border-2 ${activeMediaIndex === index ? color.border : 'border-transparent'}`}>
                                        {isYoutube(item) ? (<img src={getYoutubeThumbnail(item)} alt={`Thumbnail ${index + 1}`} className="w-full h-full object-cover" />) : (<img src={item} alt={`Thumbnail ${index + 1}`} className="w-full h-full object-cover" />)}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="bg-white rounded-lg shadow-md p-6 mt-8">
                        <h3 className="text-2xl font-bold mb-4">Description</h3>
                        <p className="text-gray-800 whitespace-pre-wrap">{creation.description}</p>
                    </div>

                    {showcaseVideos.length > 0 && (
                        <div className="bg-white rounded-lg shadow-md p-6 mt-8">
                            <h3 className="text-2xl font-bold mb-4">Showcase</h3>
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
                        <div className="bg-white rounded-lg shadow-md p-6 mt-8">
                            <h3 className="text-2xl font-bold mb-4">Changelog</h3>
                            <div className="h-48 overflow-y-auto pr-2 space-y-4">
                                {sortedChangelog.map((entry, index) => (
                                    <div key={index} className="pb-4 border-b last:border-b-0">
                                        <p className="font-semibold text-gray-800">{entry.text}</p>
                                        <p className="text-xs text-gray-500 mt-1">{formatDate(entry.timestamp)}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {eventDetails && eventSubmissions && (
                        <div className="bg-white rounded-lg shadow-md p-6 mt-8">
                            <h3 className="text-2xl font-bold mb-4">
                                Event Specific Information for <Link to={`/event/${eventDetails.id}`} className="text-blue-500 hover:underline">{eventDetails.title}</Link>
                            </h3>
                            <div className="space-y-4">
                                {eventDetails.customFields?.map(field => (
                                    <div key={field.id}>
                                        <p className="font-semibold text-gray-700">{field.label}</p>
                                        <p className="text-gray-600 pl-2 border-l-2 ml-2">{eventSubmissions[field.id] || "No answer provided."}</p>
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
                    <div className="bg-white rounded-lg shadow-md p-6">
                        <Link to={`/profile/${creation.userId}`} className="flex items-center mb-4 cursor-pointer">
                            {creatorProfile ? (
                                <>
                                    <img src={displayProfilePic || 'https://placehold.co/64x64/e2e8f0/64748b?text=P'} alt="Creator profile" className="w-16 h-16 rounded-full object-cover mr-4"/>
                                    <div>
                                        <p className="text-sm text-gray-500">Creator</p>
                                        <span className={`text-xl font-bold ${color.text} hover:underline`}>{displayUsername}</span>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div className="w-16 h-16 rounded-full bg-gray-200 animate-pulse mr-4"></div>
                                    <div>
                                        <p className="text-sm text-gray-500">Creator</p>
                                        <div className="h-6 w-32 bg-gray-200 rounded animate-pulse"></div>
                                    </div>
                                </>
                            )}
                        </Link>
                        <div className="mt-6 pt-6 border-t text-sm text-gray-600 space-y-4">
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
                                    <p className="text-sm font-bold text-gray-600 mb-1">Share Code</p>
                                    <button onClick={handleCopyShareCode} className="w-full font-mono bg-gray-100 p-2 rounded text-center hover:bg-gray-200 transition-colors">{creation.shareCode}</button>
                                </div>
                            )}

                            {originBackupUrl && (
                                <div>
                                    <p className="text-sm font-bold text-gray-600 mb-1">Direct Install</p>
                                    {isElectron ? (
                                        <a href={directImportUrl} className={`w-full flex items-center justify-center gap-2 p-3 rounded-lg font-semibold text-white transition-colors ${color.bg} ${color.hoverBg}`}>
                                            <Icon path={ICONS.download} className="w-5 h-5" />
                                            Direct Install
                                        </a>
                                    ) : (
                                        <Link to="/client-info" className={`w-full flex items-center justify-center gap-2 p-3 rounded-lg font-semibold text-white transition-colors ${color.bg} ${color.hoverBg}`}>
                                            <Icon path={ICONS.download} className="w-5 h-5" />
                                            Direct Install with Client
                                        </Link>
                                    )}
                                </div>
                            )}
                        </div>
                        
                        {creation.customMediaLink && (<div className="mt-4"><p className="text-sm font-bold text-gray-600 mb-1">Custom Media</p><button onClick={() => setExternalLink(creation.customMediaLink)} className={`${color.text} hover:underline break-all text-left`}>Download Link</button></div>)}
                        <CreationSharingQrCode creationId={id} creationName={creation.title} />
                        <div className="mt-6 pt-6 border-t"><p className="text-sm font-bold text-gray-600 mb-2">Tags</p><div className="flex flex-wrap gap-2">{creation.tags?.map(tag => (<button key={tag} onClick={() => navigate(`/?game=${creation.game}&tag=${encodeURIComponent(tag)}`)} className="bg-gray-200 text-gray-800 text-sm font-semibold px-2.5 py-1 rounded-full hover:bg-gray-300 transition-colors cursor-pointer">{tag}</button>))}</div></div>
                    </div>
                    {loadingCommunities ? (
                        <div className="bg-white rounded-lg shadow-md p-6 animate-pulse">
                            <div className="h-6 bg-gray-200 rounded w-1/2 mb-4"></div>
                            <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                            <div className="h-4 bg-gray-200 rounded w-1/2"></div>
                        </div>
                    ) : communityDetails.length > 0 && (
                        <div className="space-y-4">{communityDetails.map(communityInfo => (<CommunityInfoCard key={communityInfo.communityId} communityInfo={communityInfo} setModalMessage={setModalMessage} />))}</div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CreationDetail;