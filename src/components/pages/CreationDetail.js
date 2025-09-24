import React, { useState, useEffect } from 'react';
import { useNavigate, Link, useParams } from 'react-router-dom';
import { onSnapshot, doc, getDoc, collection, deleteDoc, query, where, documentId, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getGameColor, ICONS } from '../../utils/helpers';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import CommunityInfoCard from '../cards/CommunityInfoCard';
import { useCreationDetail } from '../../hooks/useCreationDetail';

const CreationDetail = ({ user, userProfile, setModalMessage, setConfirmation, setExternalLink, setReportModal, creationIdOverride }) => {
    const { id: idFromUrl } = useParams();
    const id = creationIdOverride || idFromUrl;

    const { data: creation, isLoading, isError, error } = useCreationDetail(id);

    const [isFollowing, setIsFollowing] = useState(false);
    const [activeMediaIndex, setActiveMediaIndex] = useState(0);
    const [hasAlreadyReported, setHasAlreadyReported] = useState(false);
    const [creatorProfile, setCreatorProfile] = useState(null);
    const [communityDetails, setCommunityDetails] = useState([]);
    const [eventDetails, setEventDetails] = useState(null);
    const [userVote, setUserVote] = useState(null);
    const [isCopied, setIsCopied] = useState(false);
    const navigate = useNavigate();

    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        return new Date(timestamp.seconds * 1000).toLocaleDateString();
    };

    const getYoutubeThumbnail = (url) => {
        if (!url) return null;
    
        let videoId = null;
        const patterns = [
            /(?:https?:\/\/)?(?:www\.)?youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
            /(?:https?:\/\/)?(?:www\.)?youtu\.be\/([a-zA-Z0-9_-]{11})/,
            /(?:https?:\/\/)?(?:www\.)?youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
            /(?:https?:\/\/)?(?:www\.)?youtube\.com\/v\/([a-zA-Z0-9_-]{11})/,
            /(?:https?:\/\/)?(?:www\.)?youtube\.com\/live\/([a-zA-Z0-9_-]{11})/
        ];
    
        for (const pattern of patterns) {
            const match = url.match(pattern);
            if (match && match[1]) {
                videoId = match[1];
                break;
            }
        }
    
        if (videoId) {
            return `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;
        }
    
        return null;
    };

    useEffect(() => {
        if (!creation) return;

        let isMounted = true;
        
        const fetchRelatedData = async () => {
            if (creation.userId) {
                const profileRef = doc(db, 'profiles', creation.userId);
                const profileSnap = await getDoc(profileRef);
                if (isMounted && profileSnap.exists()) setCreatorProfile(profileSnap.data());
            }

            if (creation.communityIds && creation.communityIds.length > 0) {
                const communityQuery = query(collection(db, 'communitys'), where(documentId(), 'in', creation.communityIds));
                const communitySnapshots = await getDocs(communityQuery);
                const communitiesMap = new Map(communitySnapshots.docs.map(doc => [doc.id, { id: doc.id, ...doc.data() }]));

                const detailsPromises = (creation.communityAssignments || []).map(async (assignment) => {
                    const communityData = communitiesMap.get(assignment.communityId);
                    if (!communityData) return null;

                    const memberRef = doc(db, 'communitys', assignment.communityId, 'members', creation.userId);
                    const linkRef = doc(db, 'communitys', assignment.communityId, 'creations', creation.id);
                    
                    const [memberSnap, linkSnap] = await Promise.all([getDoc(memberRef), getDoc(linkRef)]);

                    if (memberSnap.exists()) {
                        const memberData = memberSnap.data();
                        const creatorRanks = (memberData.roles || []).map(roleName => {
                            return communityData.ranks.find(r => r.name.toLowerCase() === roleName.toLowerCase());
                        }).filter(Boolean);

                        return {
                            communityId: assignment.communityId,
                            communityName: communityData.name,
                            communityProfileImageUrl: communityData.profileImageUrl,
                            themeColor: communityData.themeColor,
                            creatorRanksInCommunity: creatorRanks,
                            customFieldsSchema: communityData.customCreationFields,
                            customData: creation.communitySpecificData?.[assignment.communityId],
                            showcaseVideoUrl: linkSnap.exists() ? linkSnap.data().showcaseVideoUrl : null,
                            slug: communityData.slug
                        };
                    }
                    return null;
                });
                const resolvedDetails = (await Promise.all(detailsPromises)).filter(Boolean);
                if (isMounted) setCommunityDetails(resolvedDetails);
            }

            if (creation.eventIds && creation.eventIds.length > 0) {
                const firstEventId = creation.eventIds[0];
                const eventRef = doc(db, 'events', firstEventId);
                const eventSnap = await getDoc(eventRef);
                if (isMounted && eventSnap.exists()) {
                    setEventDetails({ id: eventSnap.id, ...eventSnap.data() });
                }
            } else {
                if (isMounted) setEventDetails(null);
            }

            const videoCount = creation.videoUrls?.length || 0;
            const imageCount = creation.imageUrls?.length || 0;
            const initialIndex = imageCount > 0 ? videoCount : 0;
            if (isMounted) setActiveMediaIndex(initialIndex);
        };

        fetchRelatedData();

        return () => { isMounted = false; };
    }, [creation]);
    
    useEffect(() => {
        if (!user || !id) return;
        let isMounted = true;
        const followRef = doc(db, 'users', user.uid, 'following', id);
        const unsubFollow = onSnapshot(followRef, (doc) => {
            if (isMounted) setIsFollowing(doc.exists());
        });
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
        return () => { isMounted = false; unsubFollow(); unsubVote(); };
    }, [id, user]);

    const handleShare = async () => {
        const shareData = {
            title: creation.title,
            text: `Check out "${creation.title}" on PlanetCreations!`,
            url: window.location.href,
        };
        try {
            if (navigator.share) {
                await navigator.share(shareData);
            } else {
                throw new Error("Web Share API not supported");
            }
        } catch (error) {
            console.warn("Share failed, falling back to clipboard:", error);
            try {
                await navigator.clipboard.writeText(window.location.href);
                setModalMessage("Link copied to clipboard!");
            } catch (copyError) {
                setModalMessage("Could not copy link to clipboard.");
            }
        }
    };
    
    const handleVote = async (newVoteType) => { /* ... Logik ... */ };
    const handleFollow = async () => { /* ... Logik ... */ };
    const handleReport = () => { /* ... Logik ... */ };
    
    const handleDelete = () => {
        setConfirmation({
            message: 'Are you sure you want to permanently delete this creation? All associated data will be removed. This action cannot be undone.',
            onConfirm: async () => {
                try {
                    const creationRef = doc(db, 'creations', id);
                    await deleteDoc(creationRef);
                    setModalMessage('Creation deleted successfully.');
                    navigate('/');
                } catch (error) {
                    console.error("Error deleting creation: ", error);
                    setModalMessage(`Error: Could not delete creation. ${error.message}`);
                }
            }
        });
    };

    const handleCopyShareCode = async () => {
        if (!creation.shareCode || !navigator.clipboard) return;

        try {
            await navigator.clipboard.writeText(creation.shareCode);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy share code: ', err);
        }
    };

    const handleTagClick = (tag) => {
        navigate(`/?tag=${encodeURIComponent(tag)}`);
    };

    if (isLoading) return <Spinner gameId={creation?.game} />;
    if (isError) {
        setModalMessage(`Error: ${error.message}`);
        if (!creationIdOverride) navigate('/');
        return null;
    }
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

    const isSteamWorkshopLinkable = 
        (creation.game === 'planet-coaster' || creation.game === 'planet-zoo') &&
        (creation.platform === 'pc' || !creation.platform);

    const isYoutube = (url) => url && (url.includes('youtube.com') || url.includes('youtu.be'));
    const getYoutubeEmbedUrl = (url) => {
        const videoId = getYoutubeThumbnail(url)?.split('/')[4];
        return videoId ? `https://www.youtube.com/embed/${videoId}` : '';
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

    return (
        <div className="container mx-auto mt-8 p-4">
            <style>
                {`
                @keyframes pulse-green {
                    0% { background-color: #f3f4f6; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.7); }
                    50% { background-color: #10b981; box-shadow: 0 0 0 10px rgba(16, 185, 129, 0); }
                    100% { background-color: #f3f4f6; box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
                }
                .animate-pulse-green { animation: pulse-green 2s ease-out; }
                `}
            </style>

            <div className="flex justify-between items-center mb-4">
                <button onClick={() => navigate(-1)} className={`flex items-center justify-center ${color.bg} ${color.hoverBg} text-white px-4 py-2 rounded-md transition-colors font-semibold`}>
                    <Icon path={ICONS.arrowLeft} className="w-5 h-5 mr-2"/> Back
                </button>
                <div className="flex items-center space-x-2">
                    <button onClick={handleShare} title="Share Creation" className="flex items-center justify-center w-10 h-10 rounded-full bg-gray-200 text-gray-600 hover:bg-gray-300 transition-colors"><Icon path={ICONS.share} className="w-6 h-6" /></button>
                    {user && (<button onClick={handleFollow} title={isFollowing ? "Unfollow Creation" : "Follow Creation"} className={`flex items-center justify-center w-10 h-10 rounded-full transition-colors ${isFollowing ? 'bg-yellow-400 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}><Icon path={ICONS.star} className="w-6 h-6" solid={isFollowing} /></button>)}
                    {canEdit && (<button onClick={() => navigate(`/creation/${id}/edit`)} className="flex items-center justify-center w-10 h-10 bg-yellow-500 hover:bg-yellow-600 text-white rounded-full transition-colors"><Icon path={ICONS.edit} className="w-5 h-5" solid/></button>)}
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
                            <img src={displayProfilePic || 'https://placehold.co/64x64/e2e8f0/64748b?text=P'} alt="Creator profile" className="w-16 h-16 rounded-full object-cover mr-4"/>
                            <div>
                                <p className="text-sm text-gray-500">Creator</p>
                                <span className={`text-xl font-bold ${color.text} hover:underline`}>{displayUsername}</span>
                            </div>
                        </Link>
                        <div className="mt-6 pt-6 border-t text-sm text-gray-600 space-y-4">
                            <div className="flex items-center justify-between"><span className="font-bold">Status:</span><span className={`px-2 py-1 rounded-full font-semibold text-xs ${creation.status === 'finished' ? 'bg-green-100 text-green-800' : 'bg-orange-100 text-orange-800'}`}>{creation.status === 'finished' ? 'Finished' : 'Work in Progress'}</span></div>
                            <div className="flex items-center justify-between"><span className="font-bold">Rating:</span><div className="flex items-center space-x-4"><button onClick={() => handleVote('like')} disabled={!user} className={`flex items-center space-x-1 transition-colors ${userVote === 'like' ? 'text-green-500' : 'text-gray-400 hover:text-green-500'}`}><Icon path={ICONS.thumbUp} className="w-5 h-5" solid={userVote === 'like'}/><span className="font-bold">{creation.likes || 0}</span></button><button onClick={() => handleVote('dislike')} disabled={!user} className={`flex items-center space-x-1 transition-colors ${userVote === 'dislike' ? 'text-red-500' : 'text-gray-400 hover:text-red-500'}`}><Icon path={ICONS.thumbDown} className="w-5 h-5" solid={userVote === 'dislike'}/><span className="font-bold">{creation.dislikes || 0}</span></button></div></div>
                            <div className="flex items-center justify-between"><span className="font-bold">Created:</span><span>{formatDate(creation.createdAt)}</span></div>
                            <div className="flex items-center justify-between"><span className="font-bold">Updated:</span><span>{formatDate(creation.updatedAt)}</span></div>
                            <button onClick={handleReport} disabled={hasAlreadyReported} className="w-full flex items-center justify-center space-x-2 text-gray-500 hover:text-red-500 disabled:text-gray-400 disabled:cursor-not-allowed transition-colors pt-4 border-t mt-4"><Icon path={ICONS.flag} className="w-5 h-5"/><span>{hasAlreadyReported ? 'Already Reported' : 'Report Creation'}</span></button>
                        </div>
                        {creation.shareCode && (
                            <div className="mt-6 pt-6 border-t">
                                <p className="text-sm font-bold text-gray-600 mb-1">
                                    {isSteamWorkshopLinkable ? 'Steam Workshop' : 'Share Code'}
                                </p>
                                {isSteamWorkshopLinkable ? (
                                    <a 
                                        href={`steam://url/CommunityFilePage/${creation.shareCode}`}
                                        className="block w-full font-mono bg-gray-100 p-2 rounded text-center hover:bg-gray-200 transition-colors"
                                        title="Click to open in Steam"
                                    >
                                        {creation.shareCode}
                                    </a>
                                ) : (
                                    <button 
                                        onClick={handleCopyShareCode} 
                                        className={`w-full font-mono p-2 rounded text-center transition-colors ${
                                            isCopied 
                                                ? 'bg-green-500 text-white animate-pulse-green' 
                                                : 'bg-gray-100 hover:bg-gray-200'
                                        }`}
                                        title="Click to copy share code"
                                        disabled={isCopied}
                                    >
                                        {isCopied ? 'Copied!' : creation.shareCode}
                                    </button>
                                )}
                            </div>
                        )}
                        {creation.customMediaLink && (<div className="mt-4"><p className="text-sm font-bold text-gray-600 mb-1">Custom Media</p><button onClick={() => setExternalLink(creation.customMediaLink)} className={`${color.text} hover:underline break-all text-left`}>Download Link</button></div>)}
                        <div className="mt-6 pt-6 border-t"><p className="text-sm font-bold text-gray-600 mb-2">Tags</p>
                            <div className="flex flex-wrap gap-2">
                                {creation.tags?.map(tag => (
                                    <button 
                                        key={tag} 
                                        onClick={() => handleTagClick(tag)}
                                        className="bg-gray-200 text-gray-800 text-sm font-semibold px-2.5 py-1 rounded-full hover:bg-gray-300 transition-colors"
                                    >
                                        {tag}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                    {communityDetails.length > 0 && (<div className="space-y-4">{communityDetails.map(communityInfo => (<CommunityInfoCard key={communityInfo.communityId} communityInfo={communityInfo} setModalMessage={setModalMessage} />))}</div>)}
                </div>
            </div>
        </div>
    );
};

export default CreationDetail;