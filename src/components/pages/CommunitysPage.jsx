import React, { useState, useEffect, useMemo, useRef, useCallback, useTransition } from 'react';
import { useLocation } from 'react-router-dom';
import { db } from '../../firebase/config';
import { collection, collectionGroup, query, onSnapshot, where, getDocs } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import Spinner from '../ui/Spinner';
import CommunityCard from '../cards/CommunityCard';
import PartnerCommunityCard from '../cards/PartnerCommunityCard';
import InviteCommunityCard from '../cards/InviteCommunityCard';
import FloatingActionButtonCommunity from '../ui/FloatingActionButtonCommunity';
import FloatingActionButtonManage from '../ui/FloatingActionButtonManage';
import AllEventsPage from './AllEventsPage';
import CommunitySuggestions from '../ui/CommunitySuggestions';
import CollaborationsTab from '../collaboration/CollaborationsTab';
import Icon from '../ui/Icon';
import { ICONS, getGameColor } from '../../utils/helpers';
import { getEnabledGameIds } from '../../utils/gamesRegistry';
import useGames from '../../hooks/useGames';
import { useCommunities } from '../../hooks/useCommunities';

const PARTNER_TAB = 'Partner Communitys';
const KNOWN_TABS = [PARTNER_TAB, 'Browser', 'My Communitys', 'Invitations', 'All Events', 'Collaborations'];

const CommunitysPage = ({ user, userProfile, communitysState, setCommunitysState, setModalMessage }) => {
    const location = useLocation();
    const [invitations, setInvitations] = useState([]);
    const { data: allCommunitys, isLoading: loading } = useCommunities();
    const partnerTabAvailable = useMemo(
        () => (allCommunitys || []).some(community => community.isPartner === true),
        [allCommunitys]
    );
    const publicLandingTab = partnerTabAvailable ? PARTNER_TAB : 'Browser';
    const TABS = useMemo(() => [
        ...(partnerTabAvailable ? [PARTNER_TAB] : []),
        'Browser',
        'My Communitys',
        ...(invitations.length > 0 ? ['Invitations'] : []),
        'All Events',
        'Collaborations',
    ], [invitations.length, partnerTabAvailable]);
    const tabRefs = useRef([]);
    const gliderRef = useRef(null);
    const initialTabResolvedRef = useRef(false);
    const initialTabAudienceRef = useRef(null);
    const requestedTab = useMemo(
        () => new URLSearchParams(location.search).get('tab'),
        [location.search]
    );
    const hasValidRequestedTab = KNOWN_TABS.includes(requestedTab) &&
        (requestedTab !== PARTNER_TAB || partnerTabAvailable);
    
    const [isPending, startTransition] = useTransition();

    const [myCommunityIds, setMyCommunityIds] = useState([]);
    const [userHasCommunity, setUserHasCommunity] = useState(false);
    const [ownedCommunityId, setOwnedCommunityId] = useState(null);
    const [visibleCommunities, setVisibleCommunities] = useState([]);
    const [page, setPage] = useState(1);
    const COMMUNITIES_PER_PAGE = 12;
    const [refreshTrigger, setRefreshTrigger] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);
    
    const [cooldownActive, setCooldownActive] = useState(false);
    const [cooldownTime, setCooldownTime] = useState('');
    const cooldownIntervalRef = useRef();

    const games = useGames();
    const GAME_TABS = useMemo(() => [
        { id: 'all', name: 'All Games' },
        ...games,
    ], [games]);
    const gameTabRefs = useRef([]);
    const gameGliderRef = useRef(null);
    const activeGameColor = getGameColor(communitysState.activeGameFilter);

    const handleTabClick = (tabName) => {
        startTransition(() => {
            setCommunitysState(prev => ({...prev, activeTab: tabName, searchTerm: ''}));
        });
    };
    
    const startCooldown = useCallback(() => {
        const COOLDOWN_DURATION = 3600 * 1000;
        const lastRefreshTime = Date.now();
        localStorage.setItem('refreshSuggestionsCooldown', lastRefreshTime.toString());

        const updateTimer = () => {
            const now = Date.now();
            const elapsedTime = now - lastRefreshTime;
            const remainingTime = COOLDOWN_DURATION - elapsedTime;

            if (remainingTime <= 0) {
                setCooldownActive(false);
                setCooldownTime('');
                clearInterval(cooldownIntervalRef.current);
            } else {
                setCooldownActive(true);
                const minutes = Math.floor((remainingTime / 1000 / 60) % 60);
                const seconds = Math.floor((remainingTime / 1000) % 60);
                setCooldownTime(`${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
            }
        };
        clearInterval(cooldownIntervalRef.current);
        updateTimer();
        cooldownIntervalRef.current = setInterval(updateTimer, 1000);
    }, []);

    useEffect(() => {
        const lastRefresh = localStorage.getItem('refreshSuggestionsCooldown');
        if (lastRefresh) {
            const COOLDOWN_DURATION = 3600 * 1000;
            const remainingTime = COOLDOWN_DURATION - (Date.now() - parseInt(lastRefresh, 10));
            if (remainingTime > 0) {
                startCooldown();
            }
        }
        return () => clearInterval(cooldownIntervalRef.current);
    }, [startCooldown]);

    const handleRefreshSuggestions = async () => {
        setIsRefreshing(true);
        const functions = getFunctions();
        const refreshDiscordGuilds = httpsCallable(functions, 'refreshDiscordGuilds');
        try {
            await refreshDiscordGuilds();
            setRefreshTrigger(prev => !prev);
            setModalMessage("Your Discord server list has been refreshed.");
            startCooldown();
        } catch (error) {
            setModalMessage(`Error refreshing servers: ${error.message}`);
        } finally {
            setIsRefreshing(false);
        }
    };
    
    useEffect(() => {
        const activeTabIndex = TABS.findIndex(tab => tab === communitysState.activeTab);
        const activeTabNode = tabRefs.current[activeTabIndex];
        if (activeTabNode && gliderRef.current) {
            gliderRef.current.style.left = `${activeTabNode.offsetLeft}px`;
            gliderRef.current.style.width = `${activeTabNode.offsetWidth}px`;
        }
    }, [communitysState.activeTab, TABS]);

    useEffect(() => {
        if(communitysState.activeTab !== 'Browser') return;
        const activeGameIndex = GAME_TABS.findIndex(tab => tab.id === communitysState.activeGameFilter);
        const activeGameNode = gameTabRefs.current[activeGameIndex];
        if (activeGameNode && gameGliderRef.current) {
            gameGliderRef.current.style.left = `${activeGameNode.offsetLeft}px`;
            gameGliderRef.current.style.width = `${activeGameNode.offsetWidth}px`;
        }
    }, [communitysState.activeGameFilter, communitysState.activeTab, GAME_TABS]);

    useEffect(() => {
        if (loading) return undefined;
        const audience = user?.uid || 'signed-out';
        if (initialTabAudienceRef.current !== audience) {
            initialTabAudienceRef.current = audience;
            initialTabResolvedRef.current = false;
        }

        if (user && user.uid) {
            const membershipsRef = collection(db, 'profiles', user.uid, 'communityMemberships');
            const unsubscribe = onSnapshot(membershipsRef, (snapshot) => {
                const ids = snapshot.docs.map(doc => doc.id);
                setMyCommunityIds(ids);

                if (!initialTabResolvedRef.current && !hasValidRequestedTab) {
                    setCommunitysState(prev => ({
                        ...prev,
                        activeTab: ids.length > 0 ? 'My Communitys' : publicLandingTab,
                    }));
                    initialTabResolvedRef.current = true;
                }
            });
            return () => unsubscribe();
        } else {
            setMyCommunityIds([]);
            if (!initialTabResolvedRef.current && !hasValidRequestedTab) {
                setCommunitysState(prev => ({ ...prev, activeTab: publicLandingTab }));
                initialTabResolvedRef.current = true;
            }
        }
    }, [
        user,
        hasValidRequestedTab,
        loading,
        publicLandingTab,
        setCommunitysState,
    ]);

    useEffect(() => {
        if (!loading && !partnerTabAvailable &&
            communitysState.activeTab === PARTNER_TAB) {
            setCommunitysState(prev => ({...prev, activeTab: 'Browser'}));
        }
    }, [
        communitysState.activeTab,
        loading,
        partnerTabAvailable,
        setCommunitysState,
    ]);

    useEffect(() => {
        if (!user?.uid) {
            setInvitations([]);
            return undefined;
        }
        const invitesQuery = query(
            collectionGroup(db, 'invites'),
            where('userId', '==', user.uid)
        );
        const unsubscribe = onSnapshot(invitesQuery, snapshot => {
            setInvitations(snapshot.docs.map(inviteDoc => ({
                id: inviteDoc.id,
                ...inviteDoc.data(),
            })));
        }, error => {
            setModalMessage(`Could not load community invitations: ${error.message}`);
        });
        return unsubscribe;
    }, [user, setModalMessage]);

    useEffect(() => {
        if (requestedTab && TABS.includes(requestedTab)) {
            setCommunitysState(prev => ({ ...prev, activeTab: requestedTab }));
            initialTabResolvedRef.current = true;
        }
    }, [requestedTab, setCommunitysState, TABS]);

    useEffect(() => {
        if (communitysState.activeTab === 'Invitations' && invitations.length === 0) {
            setCommunitysState(prev => ({
                ...prev,
                activeTab: myCommunityIds.length > 0 ? 'My Communitys' : publicLandingTab,
            }));
        }
    }, [
        communitysState.activeTab,
        invitations.length,
        myCommunityIds.length,
        publicLandingTab,
        setCommunitysState,
    ]);

    useEffect(() => {
        const canCreateRoles = ['influencer', 'moderator', 'admin'];
        if (user && userProfile && canCreateRoles.includes(userProfile.role)) {
            const checkCommunity = async () => {
                const q = query(collection(db, 'communitys'), where('ownerId', '==', user.uid));
                const querySnapshot = await getDocs(q);
                if (!querySnapshot.empty) {
                    setUserHasCommunity(true);
                    setOwnedCommunityId(querySnapshot.docs[0].id);
                } else {
                    setUserHasCommunity(false);
                    setOwnedCommunityId(null);
                }
            };
            checkCommunity();
        } else {
            setUserHasCommunity(false);
            setOwnedCommunityId(null);
        }
    }, [user, userProfile]);
    
    const filteredAndSortedCommunitys = useMemo(() => {
        let communitys;
        const sourceCommunities = allCommunitys || [];

        if (communitysState.activeTab === PARTNER_TAB) {
            communitys = sourceCommunities.filter(c => c.isPartner === true);
        } else if (communitysState.activeTab === 'My Communitys') {
            if (!user) return [];
            communitys = sourceCommunities.filter(c => myCommunityIds.includes(c.id));
        } else {
            communitys = [...sourceCommunities];
        }

        if (communitysState.activeTab === 'Browser' && communitysState.activeGameFilter !== 'all') {
            communitys = communitys.filter(c => 
                (c.allowedGames || getEnabledGameIds()).includes(communitysState.activeGameFilter)
            );
        }

        if (communitysState.searchTerm.trim()) {
            const lowerCaseSearch = communitysState.searchTerm.toLowerCase();
            communitys = communitys.filter(c =>
                (c.name || '').toLowerCase().includes(lowerCaseSearch) ||
                (c.description || '').toLowerCase().includes(lowerCaseSearch)
            );
        }
        
        communitys.sort((a, b) => {
            if (communitysState.activeTab === 'My Communitys' && user) {
                if (a.ownerId === user.uid) return -1;
                if (b.ownerId === user.uid) return 1;
            }
            const sortBy = communitysState.sortBy || 'memberCount';
            return (b[sortBy] || 0) - (a[sortBy] || 0);
        });

        return communitys;
    }, [allCommunitys, communitysState, myCommunityIds, user]);
    
    useEffect(() => {
        setPage(1);
    }, [filteredAndSortedCommunitys]);

    useEffect(() => {
        const newVisible = filteredAndSortedCommunitys.slice(0, page * COMMUNITIES_PER_PAGE);
        setVisibleCommunities(newVisible);
    }, [page, filteredAndSortedCommunitys]);

    const hasMore = visibleCommunities.length < filteredAndSortedCommunitys.length;

    useEffect(() => {
        const handleScroll = () => {
            const isBottom = window.innerHeight + document.documentElement.scrollTop + 1 >= document.documentElement.offsetHeight;
            if (isBottom && hasMore) {
                setPage(prevPage => prevPage + 1);
            }
        };
        if ([PARTNER_TAB, 'Browser', 'My Communitys'].includes(communitysState.activeTab)) {
            window.addEventListener('scroll', handleScroll);
        }
        return () => window.removeEventListener('scroll', handleScroll);
    }, [hasMore, communitysState.activeTab]);

    const canCreate = userProfile && ['admin', 'moderator', 'influencer'].includes(userProfile.role);
    const showCreateButton = canCreate && !userHasCommunity;
    const showManageButton = userHasCommunity;
    
    const renderContent = () => {
        if (loading) {
            return <Spinner />;
        }

        switch (communitysState.activeTab) {
            case PARTNER_TAB:
            case 'Browser':
            case 'My Communitys':
                return (
                    <>
                        {communitysState.activeTab === 'My Communitys' && userProfile?.discordId && (
                            <div className="mb-12">
                                <div className="flex justify-center items-center mb-4">
                                    <button
                                        onClick={handleRefreshSuggestions}
                                        disabled={isRefreshing || cooldownActive}
                                        className="bg-blue-500 hover:bg-blue-600 text-white font-semibold py-2 px-4 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                                    >
                                        <Icon path={ICONS.refresh} className={`w-4 h-4 mr-2 ${isRefreshing ? 'animate-spin' : ''}`} />
                                        {cooldownActive ? `Please wait (${cooldownTime})` : 'Refresh Suggestions'}
                                    </button>
                                </div>
                                <CommunitySuggestions
                                    userProfile={userProfile}
                                    myCommunityIds={myCommunityIds}
                                    refreshTrigger={refreshTrigger}
                                />
                            </div>
                        )}
                        <div className={communitysState.activeTab === PARTNER_TAB
                            ? 'grid grid-cols-1 gap-8 lg:grid-cols-2'
                            : 'grid grid-cols-1 gap-6 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4'}>
                            {visibleCommunities.map(community => (
                                communitysState.activeTab === PARTNER_TAB
                                    ? <PartnerCommunityCard key={community.id} community={community} />
                                    : <CommunityCard key={community.id} community={community} />
                            ))}
                        </div>
                        {hasMore && <div className="text-center col-span-full p-8"><Spinner /></div>}
                        {!hasMore && communitysState.activeTab === 'Browser' && visibleCommunities.length > 0 && (
                            <p className="text-center text-gray-500 mt-10 text-xl col-span-full">You've reached the end!</p>
                        )}
                        {visibleCommunities.length === 0 && (
                            <p className="text-center text-gray-500 mt-10 text-xl">
                                {communitysState.activeTab === 'My Communitys'
                                    ? "You haven't joined any communities yet."
                                    : communitysState.activeTab === PARTNER_TAB
                                        ? 'No partner communities are available yet.'
                                        : 'No communities found for this filter.'}
                            </p>
                        )}
                    </>
                );

            case 'All Events':
                return <AllEventsPage userProfile={userProfile} />;

            case 'Invitations':
                return (
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                        {invitations.map(invitation => (
                            <InviteCommunityCard
                                key={`${invitation.communityId}-${invitation.id}`}
                                invitation={invitation}
                                community={(allCommunitys || []).find(
                                    community => community.id === invitation.communityId)}
                                userId={user.uid}
                                setModalMessage={setModalMessage}
                            />
                        ))}
                    </div>
                );
            
            case 'Collaborations':
                return (
                    <CollaborationsTab
                        user={user}
                        userProfile={userProfile}
                        setModalMessage={setModalMessage}
                    />
                );

            default:
                return null;
        }
    };

    const isBrowsingCommunities = [PARTNER_TAB, 'Browser', 'My Communitys'].includes(communitysState.activeTab);

    return (
        <div className="container mx-auto p-4 sm:p-8" style={activeGameColor.style}>
            <h1 className="text-4xl font-bold text-center mb-8 text-gray-800 dark:text-gray-100">Community Hub</h1>
            
            <div className="relative flex justify-center my-6">
                <div className="relative flex items-center bg-gray-200 dark:bg-gray-700 rounded-full p-1 shadow-inner overflow-x-auto">
                    <div ref={gliderRef} className="absolute h-full bg-yellow-500 rounded-full transition-all duration-500 ease-in-out" />
                    {TABS.map((tab, index) => (
                        <button key={tab} ref={el => tabRefs.current[index] = el} onClick={() => handleTabClick(tab)} className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 text-sm sm:text-base font-medium whitespace-nowrap ${ communitysState.activeTab === tab ? 'text-white' : 'text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white'}`}>
                            {tab}
                        </button>
                    ))}
                </div>
            </div>

            {communitysState.activeTab === 'Browser' && (
                <div className="flex justify-center my-6">
                    <div className="relative flex items-center bg-gray-200 dark:bg-gray-700 rounded-full p-1 shadow-inner overflow-x-auto">
                        <div ref={gameGliderRef} className={`absolute h-full rounded-full ${activeGameColor.bg} transition-all duration-500 ease-in-out`} />
                        {GAME_TABS.map((tab, index) => (
                            <button key={tab.id} ref={el => gameTabRefs.current[index] = el} onClick={() => setCommunitysState(prev => ({...prev, activeGameFilter: tab.id}))} className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 text-sm sm:text-base font-medium whitespace-nowrap ${ communitysState.activeGameFilter === tab.id ? 'text-white' : 'text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white'}`}>
                                {tab.name}
                            </button>
                        ))}
                    </div>
                </div>
            )}
            
            {isBrowsingCommunities && (
                <div className="flex justify-center items-center mb-6 gap-4">
                    <input type="text" placeholder="Search communities..." value={communitysState.searchTerm} onChange={(e) => setCommunitysState(prev => ({...prev, searchTerm: e.target.value}))} className="w-full max-w-lg p-3 bg-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded-full focus:outline-none focus:ring-2 focus:ring-yellow-500"/>
                    {communitysState.activeTab === 'Browser' && (
                        <select value={communitysState.sortBy} onChange={(e) => setCommunitysState(prev => ({...prev, sortBy: e.target.value}))} className="p-3 border border-gray-300 dark:border-gray-600 rounded-full shadow-sm bg-white dark:bg-gray-700 dark:text-gray-100">
                            <option value="memberCount">Most Members</option>
                            <option value="createdAt">Newest</option>
                        </select>
                    )}
                </div>
            )}
            
            <div className={`transition-opacity duration-300 ${isPending ? 'opacity-50' : 'opacity-100'}`}>
                {renderContent()}
            </div>

            {showCreateButton && <FloatingActionButtonCommunity />}
            {showManageButton && <FloatingActionButtonManage communityId={ownedCommunityId} />}
        </div>
    );
};

export default CommunitysPage;
