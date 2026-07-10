import React, { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, onSnapshot, getDoc, collection, query, where, getDocs, writeBatch, serverTimestamp, collectionGroup, runTransaction } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { db } from '../../firebase/config';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import { ICONS, getYoutubeThumbnailUrl, getYoutubeEmbed } from '../../utils/helpers';
import EventCreationCard from '../cards/EventCreationCard';
import EventSubmissionModal from '../modals/EventSubmissionModal';

const EventDetailPage = ({ user, userProfile, setModalMessage, setConfirmation, setPopoverView, blacklist = [] }) => {
    const { eventId } = useParams();
    const navigate = useNavigate();
    const [event, setEvent] = useState(null);
    const [community, setCommunity] = useState(null);
    const [members, setMembers] = useState([]);
    const [connectedCreations, setConnectedCreations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [eventCountdown, setEventCountdown] = useState('');
    const [voteCountdown, setVoteCountdown] = useState('');
    const [isSubmissionModalOpen, setIsSubmissionModalOpen] = useState(false);
    const [canManageEvent, setCanManageEvent] = useState(false);
    const [userEventVotes, setUserEventVotes] = useState([]);
    const [isVoting, setIsVoting] = useState(false);
    const [voteCounts, setVoteCounts] = useState({});
    const [activeMediaIndex, setActiveMediaIndex] = useState(0);
    const [rankFilter, setRankFilter] = useState('all');
    const [sortBy, setSortBy] = useState('createdAt');

    useEffect(() => {
        if (!eventId) return;
        let isMounted = true;
        
        const eventRef = doc(db, 'events', eventId);
        const unsubscribe = onSnapshot(eventRef, async (docSnap) => {
            if (isMounted) {
                if (docSnap.exists()) {
                    const eventData = { id: docSnap.id, ...docSnap.data() };
                    setEvent(eventData);

                    let communityData = null;
                    if (eventData.communityId) {
                        const communityRef = doc(db, 'communitys', eventData.communityId);
                        const communitySnap = await getDoc(communityRef);
                        if (communitySnap.exists()) {
                            communityData = {id: communitySnap.id, ...communitySnap.data()};
                            setCommunity(communityData);
                        }
                    }

                    const membersQuery = query(collection(db, 'communitys', eventData.communityId, 'members'));
                    const membersSnap = await getDocs(membersQuery);
                    const membersData = membersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    setMembers(membersData);

                    const isSiteStaff = userProfile?.role === 'admin' || userProfile?.role === 'moderator';
                    let isCommunityStaff = false;
                    if (user && eventData.communityId) {
                        const memberRef = doc(db, 'communitys', eventData.communityId, 'members', user.uid);
                        const memberSnap = await getDoc(memberRef);
                        if (memberSnap.exists()) {
                            const memberData = memberSnap.data();
                            if (memberData.roles?.includes('owner') || memberData.roles?.includes('moderator')) {
                                isCommunityStaff = true;
                            }
                        }
                    }
                    setCanManageEvent(isSiteStaff || isCommunityStaff);

                    const creationsQuery = query(collection(db, 'creations'), where('eventIds', 'array-contains', eventId));
                    const creationsSnap = await getDocs(creationsQuery);
                    const creationsData = creationsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                    setConnectedCreations(creationsData);
                }
                setLoading(false);
            }
        });
        return () => { isMounted = false; unsubscribe(); };
    }, [eventId, user, userProfile]);

    useEffect(() => {
        if (connectedCreations.length === 0) return;
        const unsubscribers = connectedCreations.map(creation => {
            const votesQuery = query(collection(db, 'creations', creation.id, 'votes'));
            return onSnapshot(votesQuery, (snapshot) => {
                setVoteCounts(prevCounts => ({
                    ...prevCounts,
                    [creation.id]: snapshot.size
                }));
            });
        });
        return () => unsubscribers.forEach(unsub => unsub());
    }, [connectedCreations]);

    useEffect(() => {
        if (!user || !eventId) return;
        const votesQuery = query(
            collectionGroup(db, 'votes'),
            where('userId', '==', user.uid),
            where('eventId', '==', eventId)
        );
        const unsubscribe = onSnapshot(votesQuery, (snapshot) => {
            const votedCreationIds = snapshot.docs.map(doc => doc.data().creationId);
            setUserEventVotes(votedCreationIds);
        });
        return () => unsubscribe();
    }, [user, eventId]);

    useEffect(() => {
        if (!event) return;
        const calculateCountdowns = () => {
            const now = new Date();
            const startDate = event.startDate?.toDate();
            const endDate = event.endDate?.toDate();
            const voteStartDate = event.voteStartDate?.toDate();
            const voteEndDate = event.voteEndDate?.toDate();

            const formatDiff = (diff) => {
                const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
                const minutes = Math.floor((diff / 1000 / 60) % 60);
                return `${days}d ${hours}h ${minutes}m`;
            };

            if (startDate && endDate) {
                if (now < startDate) {
                    setEventCountdown(`Starts in: ${formatDiff(startDate - now)}`);
                } else if (now >= startDate && now <= endDate) {
                    const label = event.separateVoteTime ? "Submission ends in:" : "Event ends in:";
                    setEventCountdown(`${label} ${formatDiff(endDate - now)}`);
                } else {
                    setEventCountdown('Event Ended');
                }
            } else {
                setEventCountdown('Date TBD');
            }

            if (event.separateVoteTime && voteStartDate && voteEndDate) {
                if (now < voteStartDate) {
                    setVoteCountdown(`Voting starts in: ${formatDiff(voteStartDate - now)}`);
                } else if (now >= voteStartDate && now <= voteEndDate) {
                    setVoteCountdown(`Voting ends in: ${formatDiff(voteEndDate - now)}`);
                } else {
                    setVoteCountdown('Voting Ended');
                }
            } else {
                setVoteCountdown('');
            }
        };

        calculateCountdowns();
        const interval = setInterval(calculateCountdowns, 60000);
        return () => clearInterval(interval);
    }, [event]);
    
    const now = new Date();
    const startDate = event?.startDate?.toDate();
    const endDate = event?.endDate?.toDate();
    const voteStartDate = event?.voteStartDate?.toDate() || startDate;
    const voteEndDate = event?.voteEndDate?.toDate() || endDate;
    const isVotingOver = voteEndDate && now > voteEndDate;

    const filteredAndSortedCreations = useMemo(() => {
        let creations = [...connectedCreations];

        if (rankFilter !== 'all') {
            creations = creations.filter(creation => {
                const authorInfo = members.find(m => m.id === creation.userId);
                const authorRoles = authorInfo?.roles || [];
                return authorRoles.map(r => r.toLowerCase()).includes(rankFilter.toLowerCase());
            });
        }

        creations.sort((a, b) => {
            switch (sortBy) {
                case 'createdAt_asc':
                    return (a.createdAt?.seconds || 0) - (b.createdAt?.seconds || 0);
                case 'alphabetical':
                    return a.title.localeCompare(b.title);
                case 'votes':
                    if (isVotingOver) {
                        return (voteCounts[b.id] || 0) - (voteCounts[a.id] || 0);
                    }
                    return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
                case 'createdAt':
                default:
                    return (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0);
            }
        });

        return creations;
    }, [connectedCreations, members, rankFilter, sortBy, isVotingOver, voteCounts]);

    if (loading) return <Spinner />;
    if (!event) return <div className="text-center p-8">Event not found.</div>;

    const hexToRgba = (hex, alpha = 0.1) => {
        if (!hex) return `rgba(255, 255, 255, 1)`;
        try {
            const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
            hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);
            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            const [r, g, b] = result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0,0,0];
            return `rgba(${r},${g},${b},${alpha})`;
        } catch (e) { return `rgba(255, 255, 255, 1)`; }
    };

    const handleEventVote = async (creationId) => {
        if (!user || isVoting) return;
        setIsVoting(true);

        const voteRef = doc(db, 'creations', creationId, 'votes', user.uid);
        const voterRef = doc(db, 'events', eventId, 'voters', user.uid);
        const isAlreadyVoted = userEventVotes.includes(creationId);

        try {
            if (isAlreadyVoted) {
                await runTransaction(db, async (transaction) => {
                    transaction.delete(voteRef);
                    if (event.voteType === 'single') {
                        transaction.delete(voterRef);
                    }
                });
                setUserEventVotes(prev => prev.filter(id => id !== creationId));
            } else {
                if (event.voteType === 'multiple' && userEventVotes.length >= (event.voteLimit || 1)) {
                    setModalMessage(`You have reached the vote limit of ${event.voteLimit}.`);
                    setIsVoting(false);
                    return;
                }
                if (event.voteType === 'single' && userEventVotes.length > 0) {
                    setModalMessage("You can only vote for one creation in this event.");
                    setIsVoting(false);
                    return;
                }
                
                const batch = writeBatch(db);
                batch.set(voteRef, { userId: user.uid, eventId: eventId, creationId: creationId, type: 'event_vote', timestamp: serverTimestamp() });
                if (event.voteType === 'single') {
                    batch.set(voterRef, { votedFor: creationId, timestamp: serverTimestamp() });
                }
                await batch.commit();
                setUserEventVotes(prev => [...prev, creationId]);
            }
        } catch (error) {
            setModalMessage(`Error processing vote: ${error.message}`);
        } finally {
            setIsVoting(false);
        }
    };

    const handleDeleteEvent = () => {
        setConfirmation({
            message: `Are you sure you want to permanently delete the event "${event.title}"? This action cannot be undone.`,
            onConfirm: async () => {
                try {
                    const functions = getFunctions();
                    const deleteEventAsStaff = httpsCallable(functions, 'deleteEventAsStaff');
                    await deleteEventAsStaff({ eventId: eventId });
                    setModalMessage("Event has been successfully deleted.");
                    navigate(`/community/${event.communityId}`);
                } catch (error) {
                    setModalMessage(`Error deleting event: ${error.message}`);
                }
            }
        });
    };
    
    const handleCreationClick = (creationId) => {
        setPopoverView({ name: 'detail', id: creationId });
    };

    const handleSubmissionSuccess = async (submittedCreationId) => {
        setIsSubmissionModalOpen(false);
        if (submittedCreationId) {
            const creationRef = doc(db, 'creations', submittedCreationId);
            const creationSnap = await getDoc(creationRef);
            if (creationSnap.exists()) {
                const newCreation = { id: creationSnap.id, ...creationSnap.data() };
                setConnectedCreations(prev => [newCreation, ...prev.filter(c => c.id !== newCreation.id)]);
            }
        }
    };

    const isYoutube = (url) => url && (url.includes('youtube.com') || url.includes('youtu.be'));
    const getYoutubeEmbedUrl = (url) => getYoutubeEmbed(url);
    const getYoutubeThumbnail = (url) => getYoutubeThumbnailUrl(url);

    const canEdit = user?.uid === event.creatorId || canManageEvent;
    const themeColor = community?.themeColor || '#F97316';
    const formatDate = (timestamp) => {
        if (!timestamp) return 'N/A';
        return new Date(timestamp.seconds * 1000).toLocaleString();
    };
    
    const isSubmissionActive = startDate && endDate && now >= startDate && now <= endDate;
    const isVotingActive = voteStartDate && voteEndDate && now >= voteStartDate && now <= voteEndDate;

    const mediaItems = [...(event.videoUrls || []), ...(event.imageUrls || [])];
    const activeMedia = mediaItems[activeMediaIndex];
    const nextMedia = () => setActiveMediaIndex((prev) => (prev + 1) % mediaItems.length);
    const prevMedia = () => setActiveMediaIndex((prev) => (prev - 1 + mediaItems.length) % mediaItems.length);

    const voteLimitReached = event.voteType === 'multiple' && userEventVotes.length >= (event.voteLimit || 1);

    return (
        <div className="container mx-auto p-4 sm:p-8" style={{ '--theme-color': themeColor }}>
            <img src={event.bannerImageUrl || 'https://placehold.co/1200x300/e2e8f0/64748b?text=Event'} alt={`${event.title} Banner`} className="w-full h-64 object-cover rounded-lg mb-4"/>
            <div className="flex justify-between items-center mb-6">
                <button onClick={() => navigate(`/community/${event.communityId}`)} className="bg-[--theme-color] text-white font-bold py-2 px-4 rounded-lg flex items-center hover:brightness-90 transition-all">
                    <Icon path={ICONS.arrowLeft} className="w-5 h-5 mr-2" />
                    Back to Community
                </button>
                <div className="flex space-x-2">
                    {canEdit && (<button onClick={() => navigate(`/event/${eventId}/edit`)} className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-4 rounded-lg flex items-center transition-colors"><Icon path={ICONS.edit} className="w-5 h-5 mr-2" />Edit Event</button>)}
                    {canManageEvent && (<button onClick={() => navigate(`/event/${eventId}/manage`)} className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg flex items-center transition-colors"><Icon path={ICONS.cog} className="w-5 h-5 mr-2" />Manage Event</button>)}
                    {canManageEvent && (<button onClick={handleDeleteEvent} className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg flex items-center transition-colors"><Icon path={ICONS.trash} className="w-5 h-5 mr-2" />Delete Event</button>)}
                </div>
            </div>

            <div className="p-8 rounded-lg shadow-md flex flex-col gap-8 ring-4" style={{ backgroundColor: hexToRgba(themeColor, 0.2), '--tw-ring-color': themeColor }}>
                <div className="text-center w-full">
                    <h1 className="text-4xl font-bold mb-2">{String(event.title)}</h1>
                    <div className="text-gray-600 mb-6">
                        <p className="text-xl font-semibold">{eventCountdown}</p>
                        {event.separateVoteTime && voteCountdown && (
                            <p className="text-lg font-medium mt-1">{voteCountdown}</p>
                        )}
                        <p className="text-xs mt-1">({formatDate(event.startDate)} to {formatDate(event.endDate)})</p>
                    </div>
                    <h2 className="text-2xl font-bold mt-8 mb-4 border-b pb-2">Description</h2>
                    <p className="text-gray-700 whitespace-pre-wrap text-center">{String(event.description)}</p>
                </div>

                <div className="flex flex-col md:flex-row gap-8">
                    {mediaItems.length > 0 && (
                        <div className="w-full md:w-2/3">
                            <h2 className="text-2xl font-bold mb-4 border-b pb-2 text-center">Gallery</h2>
                            <div className="bg-white rounded-lg shadow-lg overflow-hidden">
                                <div className="bg-black flex justify-center items-center aspect-video relative group">
                                    {activeMedia && isYoutube(activeMedia) ? (
                                        <iframe src={getYoutubeEmbedUrl(activeMedia)} title="YouTube video player" frameBorder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowFullScreen className="w-full h-full"></iframe>
                                    ) : (
                                        <img src={activeMedia} alt="Event preview" className="max-h-[60vh] object-contain" />
                                    )}
                                    {mediaItems.length > 1 && (<>
                                        <button onClick={prevMedia} className="absolute left-2 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><Icon path={ICONS.chevronLeft} /></button>
                                        <button onClick={nextMedia} className="absolute right-2 top-1/2 -translate-y-1/2 bg-black bg-opacity-50 text-white p-2 rounded-full opacity-0 group-hover:opacity-100 transition-opacity"><Icon path={ICONS.chevronRight} /></button>
                                    </>)}
                                </div>
                                {mediaItems.length > 1 && (
                                    <div className="flex p-2 bg-gray-100 overflow-x-auto">
                                        {mediaItems.map((item, index) => (
                                            <button key={index} onClick={() => setActiveMediaIndex(index)} className={`w-24 h-16 flex-shrink-0 mx-1 rounded-md overflow-hidden border-2 ${activeMediaIndex === index ? 'border-blue-500' : 'border-transparent'}`}>
                                                {isYoutube(item) ? (<img src={getYoutubeThumbnail(item)} alt={`Thumbnail ${index + 1}`} className="w-full h-full object-cover" />) : (<img src={item} alt={`Thumbnail ${index + 1}`} className="w-full h-full object-cover" />)}
                                            </button>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                    <div className={`w-full ${mediaItems.length > 0 ? 'md:w-1/3' : 'md:w-full'} text-center`}>
                        <h2 className="text-2xl font-bold mb-4 border-b pb-2">Rules</h2>
                        <ul className="text-gray-700 whitespace-pre-wrap text-left list-disc list-inside space-y-2">
                            {event.rules?.map(rule => (<li key={rule.id}>{rule.text}</li>))}
                        </ul>
                        {(!event.rules || event.rules.length === 0) && (<p className="text-gray-500">No specific rules have been set for this event.</p>)}
                    </div>
                </div>
            </div>
            
            <div className="mt-12">
                <div className="flex flex-col md:flex-row justify-center items-center mb-8 text-center relative">
                    <h2 className="text-3xl font-bold">Event Submissions</h2>
                    <div className="md:absolute md:right-0 flex items-center gap-4 mt-4 md:mt-0">
                        <select value={rankFilter} onChange={(e) => setRankFilter(e.target.value)} className="bg-white border border-gray-300 rounded-lg p-2">
                            <option value="all">All Ranks</option>
                            {community?.ranks?.map(rank => <option key={rank.name} value={rank.name}>{rank.name}</option>)}
                        </select>
                        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="bg-white border border-gray-300 rounded-lg p-2">
                            <option value="createdAt">Newest</option>
                            <option value="createdAt_asc">Oldest</option>
                            <option value="alphabetical">Alphabetical</option>
                            {isVotingOver && <option value="votes">By Votes</option>}
                        </select>
                        {isSubmissionActive && user && (
                            <button onClick={() => setIsSubmissionModalOpen(true)} className="bg-[--theme-color] text-white font-bold py-2 px-4 rounded-lg hover:brightness-90 transition-all">Submit</button>
                        )}
                    </div>
                </div>

                {connectedCreations.length > 0 ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                        {filteredAndSortedCreations.map(creation => {
                            const isVotedForThis = userEventVotes.includes(creation.id);
                            const authorInfo = members.find(m => m.id === creation.userId);
                            const authorRoles = authorInfo?.roles || [];
                            const authorRanks = authorRoles.map(roleName => community.ranks.find(r => r.name.toLowerCase() === roleName.toLowerCase())).filter(Boolean);

                            return (
                                <EventCreationCard 
                                    key={creation.id} 
                                    creation={creation}
                                    community={community}
                                    creatorRanks={authorRanks}
                                    onClick={() => handleCreationClick(creation.id)}
                                    isVotingActive={isVotingActive}
                                    isVotingOver={isVotingOver}
                                    isVoted={isVotedForThis}
                                    voteLimitReached={voteLimitReached && !isVotedForThis}
                                    voteCount={voteCounts[creation.id] || 0}
                                    onVote={() => handleEventVote(creation.id)}
                                />
                            );
                        })}
                    </div>
                ) : (
                    <p className="text-center text-gray-500 bg-white p-8 rounded-lg shadow-md">No creations have been submitted to this event yet.</p>
                )}
            </div>
            {isSubmissionModalOpen && (
                <EventSubmissionModal
                    user={user}
                    event={event}
                    community={community}
                    onClose={handleSubmissionSuccess}
                    setModalMessage={setModalMessage}
                    blacklist={blacklist}
                />
            )}
        </div>
    );
};

export default EventDetailPage;