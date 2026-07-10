import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { db } from '../../firebase/config';
import { collection, query, onSnapshot, where, doc, getDocs, getDoc, orderBy, limit, startAfter } from 'firebase/firestore';
import { joinCommunity, leaveCommunity, deleteCommunityAsAdmin } from '../../firebase/community';
import { fetchCommunityIndex } from '../../firebase/communityIndexService';
import AddCreationsToCommunityModal from '../modals/AddCreationsToCommunityModal';
import CommunityVideosTab from '../community/CommunityVideosTab';
import Spinner from '../ui/Spinner';
import CreationCard from '../cards/CreationCard';
import MiniCreationCard from '../cards/MiniCreationCard';
import MemberCard from '../cards/MemberCard';
import EventCard from '../cards/EventCard';
import { ICONS, SOCIAL_PLATFORMS } from '../../utils/helpers';
import Icon from '../ui/Icon';
import FloatingActionButtonManage from '../ui/FloatingActionButtonManage';

const TABS = ['Creations', 'Members', 'Events'];

const CommunityDetailPage = ({ user, userProfile, setModalMessage, setConfirmation }) => {
    const { communityName } = useParams();
    const [activeTab, setActiveTab] = useState(TABS[0]);
    const tabRefs = useRef([]);
    const gliderRef = useRef(null);

    const [community, setCommunity] = useState(null);
    const [members, setMembers] = useState([]);
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isMember, setIsMember] = useState(false);
    const [isProcessingJoin, setIsProcessingJoin] = useState(false);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const navigate = useNavigate();

    const [isFilterVisible, setIsFilterVisible] = useState(false);
    const [creationStatusFilter, setCreationStatusFilter] = useState('all');
    const [creationPlatformFilter, setCreationPlatformFilter] = useState('all');
    const [memberRankFilter, setMemberRankFilter] = useState('all');
    const [creationRankFilter, setCreationRankFilter] = useState('all');
    const [creationTagFilter, setCreationTagFilter] = useState('');
    const [creationDlcFilter, setCreationDlcFilter] = useState('all');
    const filterMenuRef = useRef(null);

    // Creations der Community kommen aus dem Kompakt-Index (1 Read),
    // gepflegt von den Cloud-Function-Triggern.
    const { data: creations = [] } = useQuery({
        queryKey: ['communityIndex', community?.id],
        queryFn: () => fetchCommunityIndex(community.id),
        enabled: !!community?.id,
        staleTime: 5 * 60 * 1000,
    });

    const [loadingMoreEvents, setLoadingMoreEvents] = useState(false);
    const [lastVisibleEvent, setLastVisibleEvent] = useState(null);
    const [hasMoreEvents, setHasMoreEvents] = useState(true);

    useEffect(() => {
        let isMounted = true;
        if (!communityName) {
            navigate('/communitys');
            return;
        }

        const communityQuery = query(collection(db, 'communitys'), where('slug', '==', communityName));
        const unsubscribeCommunity = onSnapshot(communityQuery, (querySnapshot) => {
            if (!isMounted) return;

            if (querySnapshot.empty) {
                setModalMessage("Community not found.");
                navigate('/communitys');
                return;
            }
            
            const communityDoc = querySnapshot.docs[0];
            const communityData = { id: communityDoc.id, ...communityDoc.data() };
            setCommunity(communityData);
            setLoading(false);
        });

        return () => { isMounted = false; unsubscribeCommunity(); };
    }, [communityName, navigate, setModalMessage]);

    useEffect(() => {
        if (!community || !user) return;
        let isMounted = true;
        const membershipRef = doc(db, 'profiles', user.uid, 'communityMemberships', community.id);
        const unsubscribe = onSnapshot(membershipRef, (doc) => {
            if (isMounted) setIsMember(doc.exists());
        });
        return () => { isMounted = false; unsubscribe(); };
    }, [user, community]);

    useEffect(() => {
        if (!community) return;
        let isMounted = true;

        const fetchMembers = async () => {
            const membersQuery = collection(db, 'communitys', community.id, 'members');
            const membersSnapshot = await getDocs(membersQuery);
            const memberPromises = membersSnapshot.docs.map(async (memberDoc) => {
                const profileSnap = await getDoc(doc(db, 'profiles', memberDoc.id));
                return { id: memberDoc.id, ...memberDoc.data(), ...(profileSnap.exists() ? profileSnap.data() : {}) };
            });
            const resolvedMembers = await Promise.all(memberPromises);
            if (isMounted) setMembers(resolvedMembers);
        };
        fetchMembers();
        return () => { isMounted = false; };
    }, [community]);
    
    useEffect(() => {
        if (!community) return;
        const fetchInitialEvents = async () => {
            setHasMoreEvents(true);
            const eventsQuery = query(
                collection(db, 'events'), 
                where('communityId', '==', community.id),
                orderBy('startDate', 'desc'),
                limit(12)
            );
            const docSnapshots = await getDocs(eventsQuery);
            const initialEvents = docSnapshots.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setEvents(initialEvents);
            setLastVisibleEvent(docSnapshots.docs[docSnapshots.docs.length - 1]);
            if (docSnapshots.docs.length < 12) {
                setHasMoreEvents(false);
            }
        };
        fetchInitialEvents();
    }, [community]);

    const fetchMoreEvents = useCallback(async () => {
        if (loading || loadingMoreEvents || !hasMoreEvents) return;
        setLoadingMoreEvents(true);

        const nextQuery = query(
            collection(db, 'events'), 
            where('communityId', '==', community.id),
            orderBy('startDate', 'desc'),
            startAfter(lastVisibleEvent),
            limit(12)
        );
        
        const docSnapshots = await getDocs(nextQuery);
        const newEvents = docSnapshots.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        if (newEvents.length > 0) {
            setEvents(prev => [...prev, ...newEvents]);
            setLastVisibleEvent(docSnapshots.docs[docSnapshots.docs.length - 1]);
        }
        
        if (newEvents.length < 12) {
            setHasMoreEvents(false);
        }
        
        setLoadingMoreEvents(false);
    }, [loading, loadingMoreEvents, hasMoreEvents, lastVisibleEvent, community]);

    useEffect(() => {
        if (activeTab !== 'Events') return;

        const handleScroll = () => {
            const isBottom = window.innerHeight + document.documentElement.scrollTop + 1 >= document.documentElement.offsetHeight;
            if (isBottom) {
                fetchMoreEvents();
            }
        };

        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, [activeTab, fetchMoreEvents]);


    const pinnedCreations = useMemo(() => creations.filter(c => c.pinned), [creations]);
    const unpinnedCreations = useMemo(() => creations.filter(c => !c.pinned), [creations]);

    // Videos-Tab nur anzeigen, wenn es für die Community relevante Videos gibt
    // (verlinkter YouTube-Kanal, Showcase-Videos oder Event-Videos)
    const hasVideos = useMemo(() =>
        !!community?.socialLinks?.youtube ||
        creations.some(c => c.showcaseVideoUrl) ||
        events.some(e => e.videoUrls?.length > 0),
        [community?.socialLinks?.youtube, creations, events]);

    const visibleTabs = useMemo(() => hasVideos ? [...TABS, 'Videos'] : TABS, [hasVideos]);

    useEffect(() => {
        if (!visibleTabs.includes(activeTab)) setActiveTab(TABS[0]);
    }, [visibleTabs, activeTab]);

    // DLC-Optionen für den Filter aus den vorhandenen Creations aggregieren
    const availableDlcs = useMemo(() => {
        const dlcs = new Set();
        creations.forEach(c => (c.requiredDlcs || []).forEach(dlc => dlcs.add(dlc)));
        return [...dlcs].sort();
    }, [creations]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (filterMenuRef.current && !filterMenuRef.current.contains(event.target)) setIsFilterVisible(false);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        if (loading) return;
        const activeTabIndex = visibleTabs.findIndex(tab => tab === activeTab);
        const activeTabNode = tabRefs.current[activeTabIndex];
        if (activeTabNode && gliderRef.current) {
            gliderRef.current.style.left = `${activeTabNode.offsetLeft}px`;
            gliderRef.current.style.width = `${activeTabNode.offsetWidth}px`;
        }
    }, [activeTab, loading, visibleTabs]);

    const isSiteAdmin = userProfile?.role === 'admin';
    const isSiteModerator = userProfile?.role === 'moderator';
    const currentUserMemberInfo = members.find(m => m.id === user?.uid);
    const isCommunityOwner = currentUserMemberInfo?.roles?.includes('owner');
    const isCommunityModerator = currentUserMemberInfo?.roles?.includes('moderator');
    const showManageButton = isSiteAdmin || isCommunityModerator || isCommunityOwner;
    const canCreateEvent = isCommunityOwner || isCommunityModerator;
    const isStaffForEvents = isSiteAdmin || isSiteModerator || isCommunityOwner || isCommunityModerator;

    const visibleEvents = useMemo(() => {
        let filtered;
        if (isStaffForEvents) {
            filtered = events;
        } else {
            filtered = events.filter(event => event.status !== 'invisible');
        }

        if (isStaffForEvents) {
            const sortableFiltered = [...filtered];
            sortableFiltered.sort((a, b) => {
                const aIsInvisible = a.status === 'invisible';
                const bIsInvisible = b.status === 'invisible';
                if (aIsInvisible && !bIsInvisible) return -1;
                if (!aIsInvisible && bIsInvisible) return 1;
                return 0;
            });
            return sortableFiltered;
        }
        return filtered;
    }, [events, isStaffForEvents]);

    const filteredContent = useMemo(() => {
        let content;
        if (activeTab === 'Members') {
            content = members.filter(member => memberRankFilter === 'all' || member.roles?.map(r => r.toLowerCase()).includes(memberRankFilter.toLowerCase()));
        } else if (activeTab === 'Creations') {
            content = unpinnedCreations.filter(creation => {
                const statusMatch = creationStatusFilter === 'all' || creation.status === creationStatusFilter;
                const platformMatch = creationPlatformFilter === 'all' || (creation.platform || 'pc') === creationPlatformFilter;
                // Creator-Rollen kommen direkt aus dem Community-Index
                const rankMatch = creationRankFilter === 'all' || (creation.creatorRoles || []).some(r => r.toLowerCase() === creationRankFilter.toLowerCase());
                const tagTerm = creationTagFilter.trim().toLowerCase();
                const tagMatch = !tagTerm || (creation.tags || []).some(t => t.toLowerCase().includes(tagTerm));
                const dlcMatch = creationDlcFilter === 'all' || (creation.requiredDlcs || []).includes(creationDlcFilter);
                return statusMatch && platformMatch && rankMatch && tagMatch && dlcMatch;
            });
        } else {
            return [];
        }

        if (searchTerm.trim()) {
            const lowerCaseSearch = searchTerm.toLowerCase();
            content = content.filter(item =>
                (item.title && item.title.toLowerCase().includes(lowerCaseSearch)) ||
                (item.username && item.username.toLowerCase().includes(lowerCaseSearch)) ||
                (item.tags && item.tags.some(t => t.toLowerCase().includes(lowerCaseSearch)))
            );
        }
        return content;
    }, [activeTab, unpinnedCreations, members, searchTerm, creationStatusFilter, creationPlatformFilter, memberRankFilter, creationRankFilter, creationTagFilter, creationDlcFilter]);

    if (loading || !community) return <Spinner />;
    
    const handleJoin = async () => {
        if (!user) { setModalMessage("You must be logged in to join a community."); return; }
        setIsProcessingJoin(true);
        try { await joinCommunity(community.id, user.uid); }
        catch (error) { console.error("Error joining community:", error); setModalMessage(error.message); }
        finally { setIsProcessingJoin(false); }
    };

    const handleLeave = async () => {
        if (!user) return;
        setIsProcessingJoin(true);
        try { await leaveCommunity(community.id, user.uid); }
        catch (error) { console.error("Error leaving community:", error); setModalMessage(error.message); }
        finally { setIsProcessingJoin(false); }
    };
    
    const themeColor = community?.themeColor || '#F97316';

    return (
        <div className="container mx-auto p-4 sm:p-8" style={{ '--theme-color': themeColor }}>
            <div className="mb-8">
                <div className="relative mb-4">
                    <img src={community.bannerImageUrl || 'https://placehold.co/1200x300/e2e8f0/64748b?text=Community+Banner'} alt={`${community.name} Banner`} className="w-full h-48 md:h-64 object-cover rounded-lg"/>
                    {SOCIAL_PLATFORMS.some(p => community.socialLinks?.[p.id]) && (
                        <div className="absolute bottom-3 right-3 flex gap-2">
                            {SOCIAL_PLATFORMS.filter(p => community.socialLinks?.[p.id]).map(platform => (
                                <a
                                    key={platform.id}
                                    href={community.socialLinks[platform.id]}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={platform.label}
                                    className="w-9 h-9 rounded-full bg-black/60 hover:bg-[--theme-color] text-white flex items-center justify-center transition-colors shadow"
                                >
                                    <Icon path={platform.icon} solid={platform.solid} className="w-5 h-5" />
                                </a>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex flex-col md:flex-row justify-center items-center md:items-start gap-y-4 px-2">
                    <div className="flex flex-col sm:flex-row gap-2 order-2 md:order-1 w-48 flex-shrink-0">
                        <button 
                            onClick={() => navigate('/communitys')} 
                            className={`flex items-center justify-center bg-[--theme-color] hover:brightness-90 text-white px-4 py-2 rounded-md transition-all font-semibold`}
                        >
                            <Icon path={ICONS.arrowLeft} className="w-5 h-5 mr-2"/> Back to Hub
                        </button>
                        {isSiteAdmin && (
                             <button 
                                onClick={() => setConfirmation({
                                    message: `Are you sure you want to permanently delete the "${community.name}" community?`,
                                    onConfirm: async () => {
                                        try {
                                            await deleteCommunityAsAdmin(community.id);
                                            setModalMessage("Community deleted successfully.");
                                            navigate('/communitys');
                                        } catch (error) {
                                            setModalMessage(`Error deleting community: ${error.message}`);
                                        }
                                    }
                                })}
                                className={`flex items-center justify-center bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md transition-all font-semibold`}
                            >
                                <Icon path={ICONS.trash} className="w-5 h-5"/>
                            </button>
                        )}
                    </div>

                    <div className="text-center order-1 md:order-2 flex-grow">
                        <h1 className="text-4xl font-bold text-gray-800">{community.name}</h1>
                        <p className="text-gray-600 mt-2 max-w-2xl mx-auto">{community.description}</p>
                    </div>
                    
                    <div className="text-center order-3 md:order-3 md:text-right w-48 flex-shrink-0">
                        {user && !isCommunityOwner ? (
                            isMember ? (
                                <button onClick={handleLeave} disabled={isProcessingJoin} className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold py-2 px-6 rounded-lg transition-colors">
                                    {isProcessingJoin ? 'Leaving...' : 'Leave Community'}
                                </button>
                            ) : (
                                <button onClick={handleJoin} disabled={isProcessingJoin} className="bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-bold py-2 px-6 rounded-lg transition-colors">
                                    {isProcessingJoin ? 'Joining...' : 'Join Community'}
                                </button>
                            )
                        ) : (
                            <div className="h-10"></div> 
                        )}
                    </div>
                </div>
            </div>

            {pinnedCreations.length > 0 && (
                <div className="mb-12">
                    <h2 className="text-2xl font-bold mb-4 text-gray-800">Pinned Creations</h2>
                    <div className="flex overflow-x-auto space-x-4 pb-4">
                        {pinnedCreations.map(creation => (
                            <div key={creation.id} className="w-64 flex-shrink-0">
                                <MiniCreationCard creation={creation} />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="relative flex justify-center items-center my-6">
                <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner">
                    <div
                        ref={gliderRef}
                        className="absolute h-full bg-[--theme-color] rounded-full transition-all duration-300 ease-in-out"
                    />
                    {visibleTabs.map((tab, index) => (
                        <button
                            key={tab}
                            ref={el => tabRefs.current[index] = el}
                            onClick={() => setActiveTab(tab)}
                            className={`relative z-10 py-2 px-8 rounded-full transition-colors duration-300 font-medium ${ activeTab === tab ? 'text-white' : 'text-gray-600 hover:text-black'}`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
                {user && isMember && (
                    <button
                        onClick={() => setIsAddModalOpen(true)}
                        className="ml-3 w-11 h-11 flex items-center justify-center rounded-full bg-[--theme-color] text-white shadow hover:brightness-90 transition-all flex-shrink-0"
                        title="Add or remove your creations in this community"
                        aria-label="Manage your creations in this community"
                    >
                        <Icon path={ICONS.plus} className="w-6 h-6" />
                    </button>
                )}
            </div>

            {activeTab !== 'Videos' && (
            <div className="flex justify-center items-center mb-6 gap-4">
                <input
                    type="text"
                    placeholder={`Search in ${activeTab}...`}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full max-w-lg p-3 bg-gray-200 rounded-full focus:outline-none focus:ring-2"
                    style={{'--tw-ring-color': themeColor}}
                />
                <div className="relative" ref={filterMenuRef}>
                    <button onClick={() => setIsFilterVisible(!isFilterVisible)} className="p-3 bg-gray-200 rounded-full hover:bg-gray-300">
                        <Icon path={ICONS.filter} className="w-6 h-6 text-gray-700" />
                    </button>
                    {isFilterVisible && (
                        <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-xl z-20 border p-4">
                            {activeTab === 'Creations' && (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2">Status</label>
                                        <select value={creationStatusFilter} onChange={(e) => setCreationStatusFilter(e.target.value)} className="w-full p-2 border rounded-lg bg-white">
                                            <option value="all">All</option>
                                            <option value="wip">Work in Progress</option>
                                            <option value="finished">Finished</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2">Platform</label>
                                        <select value={creationPlatformFilter} onChange={(e) => setCreationPlatformFilter(e.target.value)} className="w-full p-2 border rounded-lg bg-white">
                                            <option value="all">All</option>
                                            <option value="pc">PC</option>
                                            <option value="console">Console</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2">Creator Rank</label>
                                        <select value={creationRankFilter} onChange={(e) => setCreationRankFilter(e.target.value)} className="w-full p-2 border rounded-lg bg-white">
                                            <option value="all">All Ranks</option>
                                            {community?.ranks?.map(rank => (
                                                <option key={rank.name} value={rank.name.toLowerCase()}>{rank.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 mb-2">Tag</label>
                                        <input
                                            type="text"
                                            placeholder="e.g. Coaster"
                                            value={creationTagFilter}
                                            onChange={(e) => setCreationTagFilter(e.target.value)}
                                            className="w-full p-2 border rounded-lg bg-white"
                                        />
                                    </div>
                                    {availableDlcs.length > 0 && (
                                        <div>
                                            <label className="block text-sm font-bold text-gray-700 mb-2">Required DLC</label>
                                            <select value={creationDlcFilter} onChange={(e) => setCreationDlcFilter(e.target.value)} className="w-full p-2 border rounded-lg bg-white">
                                                <option value="all">All DLCs</option>
                                                {availableDlcs.map(dlc => (
                                                    <option key={dlc} value={dlc}>{dlc}</option>
                                                ))}
                                            </select>
                                        </div>
                                    )}
                                </div>
                            )}
                             {activeTab === 'Members' && (
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-2">Filter by Rank</label>
                                    <select value={memberRankFilter} onChange={(e) => setMemberRankFilter(e.target.value)} className="w-full p-2 border rounded-lg bg-white">
                                        <option value="all">All Ranks</option>
                                        {community?.ranks?.map(rank => (
                                            <option key={rank.name} value={rank.name.toLowerCase()}>{rank.name}</option>
                                        ))}
                                    </select>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>
            )}

            {activeTab === 'Videos' && (
                <CommunityVideosTab community={community} creations={creations} events={visibleEvents} />
            )}

            {activeTab === 'Events' && (
                <div>
                    {canCreateEvent && (
                        <div className="text-center mb-6">
                            <Link to={`/community/${community.id}/create-event`} state={{ communityName: community.name }}>
                                <button className="bg-[--theme-color] hover:brightness-90 text-white font-bold py-2 px-6 rounded-lg">
                                    Create New Event
                                </button>
                            </Link>
                        </div>
                    )}
                    {visibleEvents.length > 0 ? (
                        <>
                            <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                                {visibleEvents.map(event => <EventCard key={event.id} event={event} community={community} userProfile={userProfile} />)}
                            </div>
                            {loadingMoreEvents && <div className="text-center col-span-full p-8"><Spinner /></div>}
                            {!hasMoreEvents && events.length > 0 && (
                                <p className="text-center text-gray-500 mt-10 text-xl col-span-full">You've reached the end!</p>
                            )}
                        </>
                    ) : (
                        <div className="text-center text-gray-500 mt-10 py-10 bg-white rounded-lg shadow-md">
                            <h3 className="text-2xl font-bold">No Events Yet</h3>
                            <p className="mt-2">This community hasn't scheduled any events.</p>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'Creations' && (
              <>
                <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {filteredContent.map(item => <CreationCard key={item.id} creation={item} />)}
                </div>
                {filteredContent.length === 0 && (
                    <p className="text-center text-gray-500 mt-10 text-xl">No creations found.</p>
                )}
              </>
            )}

            {activeTab === 'Members' && (
              <>
                <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {filteredContent.map(item => <MemberCard key={item.id} member={item} community={community} />)}
                </div>
                {filteredContent.length === 0 && (
                    <p className="text-center text-gray-500 mt-10 text-xl">No members found.</p>
                )}
              </>
            )}
            
            {showManageButton && (
                <FloatingActionButtonManage communityId={community.id} />
            )}

            {isAddModalOpen && user && (
                <AddCreationsToCommunityModal
                    user={user}
                    community={community}
                    onClose={() => setIsAddModalOpen(false)}
                    setModalMessage={setModalMessage}
                />
            )}
        </div>
    );
};

export default CommunityDetailPage;