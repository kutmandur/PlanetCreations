import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { db } from '../../firebase/config';
import { collection, query, onSnapshot, where, doc, getDocs, getDoc, updateDoc, orderBy, limit, startAfter } from 'firebase/firestore';
import {
    acceptCommunityInvite,
    joinCommunity,
    joinCommunityWithPassword,
    leaveCommunity,
    deleteCommunityAsAdmin,
    setCommunityPartnerStatus,
    requestCommunityJoin,
    withdrawCommunityJoinRequest,
} from '../../firebase/community';
import { fetchCommunityIndex } from '../../firebase/communityIndexService';
import AddCreationsToCommunityModal from '../modals/AddCreationsToCommunityModal';
import CommunityVideosTab from '../community/CommunityVideosTab';
import Spinner from '../ui/Spinner';
import CreationCard from '../cards/CreationCard';
import MiniCreationCard from '../cards/MiniCreationCard';
import MemberCard from '../cards/MemberCard';
import EventCard from '../cards/EventCard';
import { ICONS, SOCIAL_PLATFORMS, isEventHidden } from '../../utils/helpers';
import { scheduleDataRefresh } from '../../utils/appRefresh';
import Icon from '../ui/Icon';
import FloatingActionButtonManage from '../ui/FloatingActionButtonManage';
import {
    getEffectiveCommunityPermissions,
    hasAnyCommunityManagementPermission,
} from '../../utils/communityPermissions';
import {
    canViewCommunityInfo,
    isCommunityInfoRestricted,
} from '../../utils/communityVisibility';
import CommunityJoinModal from '../modals/CommunityJoinModal';
import OfficialPartnerBadge from '../community/OfficialPartnerBadge';
import { buildCommunityPath } from '../../utils/communityRoutes';

const TABS = ['Creations', 'Members', 'Events'];

const CommunityDetailPage = ({ user, userProfile, setModalMessage, setConfirmation }) => {
    const { communityName: rawCommunityName } = useParams();
    const communityName = String(rawCommunityName || '').toLowerCase();
    const [activeTab, setActiveTab] = useState(TABS[0]);
    const tabRefs = useRef([]);
    const gliderRef = useRef(null);

    const queryClient = useQueryClient();
    const [community, setCommunity] = useState(null);
    const [members, setMembers] = useState([]);
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [isMember, setIsMember] = useState(false);
    const [membershipResolvedCommunityId, setMembershipResolvedCommunityId] = useState(null);
    const [eventNotifyOn, setEventNotifyOn] = useState(true);
    const [isProcessingJoin, setIsProcessingJoin] = useState(false);
    const [joinRequestPending, setJoinRequestPending] = useState(false);
    const [hasInvite, setHasInvite] = useState(false);
    const [joinModalMode, setJoinModalMode] = useState(null);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    const [isUpdatingPartnerStatus, setIsUpdatingPartnerStatus] = useState(false);
    const navigate = useNavigate();

    const [isFilterVisible, setIsFilterVisible] = useState(false);
    const [creationStatusFilter, setCreationStatusFilter] = useState('all');
    const [creationPlatformFilter, setCreationPlatformFilter] = useState('all');
    const [memberRankFilter, setMemberRankFilter] = useState('all');
    const [creationRankFilter, setCreationRankFilter] = useState('all');
    const [creationTagFilter, setCreationTagFilter] = useState('');
    const [creationDlcFilter, setCreationDlcFilter] = useState('all');
    const filterMenuRef = useRef(null);
    const siteStaffBypass = ['admin', 'moderator'].includes(userProfile?.role);
    const infoPageRestricted = isCommunityInfoRestricted(community);
    const isCommunityOwnerById = !!user?.uid && community?.ownerId === user.uid;
    const membershipResolved =
        !!community?.id && membershipResolvedCommunityId === community.id;
    const infoAccessResolved =
        !infoPageRestricted || siteStaffBypass || isCommunityOwnerById || membershipResolved;
    const canViewInfoPage =
        infoAccessResolved &&
        canViewCommunityInfo(community, isMember, userProfile, user?.uid);

    // Creations der Community kommen aus dem vollständigen Shard-Index,
    // gepflegt von den Cloud-Function-Triggern.
    const { data: creations = [] } = useQuery({
        queryKey: ['communityIndex', community?.id],
        queryFn: () => fetchCommunityIndex(community.id),
        enabled: !!community?.id && community.slug === communityName && canViewInfoPage,
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
        if (!community) {
            setIsMember(false);
            setMembershipResolvedCommunityId(null);
            return undefined;
        }
        if (!user?.uid) {
            setIsMember(false);
            setMembershipResolvedCommunityId(community.id);
            return undefined;
        }

        let isMounted = true;
        setMembershipResolvedCommunityId(null);
        const membershipRef = doc(db, 'profiles', user.uid, 'communityMemberships', community.id);
        const unsubscribe = onSnapshot(
            membershipRef,
            (membershipDoc) => {
                if (!isMounted) return;
                setIsMember(membershipDoc.exists());
                setMembershipResolvedCommunityId(community.id);
            },
            (error) => {
                if (!isMounted) return;
                setIsMember(false);
                setMembershipResolvedCommunityId(community.id);
                setModalMessage(`Could not verify community membership: ${error.message}`);
            }
        );
        return () => { isMounted = false; unsubscribe(); };
    }, [user?.uid, community, setModalMessage]);

    useEffect(() => {
        if (!community || !user || isMember) {
            setJoinRequestPending(false);
            setHasInvite(false);
            return;
        }
        const unsubscribeRequest = onSnapshot(
            doc(db, 'communitys', community.id, 'joinRequests', user.uid),
            snapshot => setJoinRequestPending(snapshot.exists() && snapshot.data().status === 'pending')
        );
        const unsubscribeInvite = onSnapshot(
            doc(db, 'communitys', community.id, 'invites', user.uid),
            snapshot => setHasInvite(snapshot.exists())
        );
        return () => {
            unsubscribeRequest();
            unsubscribeInvite();
        };
    }, [community, user, isMember]);

    // Per-community event-notification preference (member doc notifyEvents, default on)
    useEffect(() => {
        if (!community || !user || !isMember) return;
        let mounted = true;
        getDoc(doc(db, 'communitys', community.id, 'members', user.uid))
            .then(snap => { if (mounted && snap.exists()) setEventNotifyOn(snap.data().notifyEvents !== false); })
            .catch(() => {});
        return () => { mounted = false; };
    }, [user, community, isMember]);

    const handleToggleEventNotify = async () => {
        if (!user || !community) return;
        const next = !eventNotifyOn;
        setEventNotifyOn(next);
        try {
            await updateDoc(doc(db, 'communitys', community.id, 'members', user.uid), { notifyEvents: next });
        } catch (e) {
            setEventNotifyOn(!next);
            setModalMessage(`Could not update event notifications: ${e.message}`);
        }
    };

    useEffect(() => {
        if (!community || !canViewInfoPage) return;
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
    }, [community, canViewInfoPage]);
    
    useEffect(() => {
        if (!community || !canViewInfoPage) return;
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
    }, [community, canViewInfoPage]);

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


    // Resolve each creator's community roles to colored rank objects (the index
    // only supplies role-name strings) so the cards can show rank pills.
    const creationsRanked = useMemo(() => {
        const ranks = community?.ranks || [];
        return creations.map(c => ({
            ...c,
            creatorRanks: (c.creatorRoles || [])
                .map(roleName => ranks.find(r => r.name.toLowerCase() === roleName.toLowerCase()))
                .filter(Boolean),
        }));
    }, [creations, community]);

    const pinnedCreations = useMemo(() => creationsRanked.filter(c => c.pinned), [creationsRanked]);
    const unpinnedCreations = useMemo(() => creationsRanked.filter(c => !c.pinned), [creationsRanked]);

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
    const currentUserMemberInfo = members.find(m => m.id === user?.uid);
    // Ownership über community.ownerId bestimmen — steht sofort mit dem Community-Doc
    // bereit, während das members-Array erst später lädt. Sonst blitzt beim Laden
    // der eigenen Community kurz der "Leave Community"-Button auf.
    const isCommunityOwner = (community?.ownerId && user)
        ? community.ownerId === user.uid
        : currentUserMemberInfo?.roles?.includes('owner');
    const memberPermissions = getEffectiveCommunityPermissions(community, currentUserMemberInfo);
    const showManageButton =
        siteStaffBypass ||
        isCommunityOwner ||
        hasAnyCommunityManagementPermission(community, currentUserMemberInfo);
    const canAddCreations = siteStaffBypass || memberPermissions.addCreations;
    const canApplyShowcase = siteStaffBypass || memberPermissions.applyShowcase;
    const canCreateEvents = siteStaffBypass || memberPermissions.createEvents;

    const handleTogglePartnerStatus = async () => {
        if (!isSiteAdmin || !community?.id || isUpdatingPartnerStatus) return;

        const nextPartnerStatus = community.isPartner !== true;
        setIsUpdatingPartnerStatus(true);
        try {
            await setCommunityPartnerStatus(community.id, nextPartnerStatus);
            await queryClient.invalidateQueries({ queryKey: ['communities'] });
            setModalMessage(
                nextPartnerStatus
                    ? `${community.name} is now a partner community.`
                    : `${community.name} is no longer a partner community.`
            );
        } catch (error) {
            setModalMessage(`Could not update partner status: ${error.message}`);
        } finally {
            setIsUpdatingPartnerStatus(false);
        }
    };

    // Öffentlicher Events-Tab ist für Owner und Nutzer identisch: unsichtbare
    // Events erscheinen nur noch im Community-Manager (Events-Tab).
    // "Invisible until event starts": ab Startzeitpunkt zählen sie als sichtbar.
    const visibleEvents = useMemo(
        () => events.filter(event => !isEventHidden(event)),
        [events]);

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

    if (loading || !community || community.slug !== communityName) return <Spinner />;
    
    const handleJoin = async () => {
        if (!user) { setModalMessage("You must be logged in to join a community."); return; }
        const joinMode = community.joinMode || 'open';
        if (joinMode === 'application') {
            setJoinModalMode('application');
            return;
        }
        if (joinMode === 'password') {
            setJoinModalMode('password');
            return;
        }
        if (joinMode === 'invite' && !hasInvite) {
            setModalMessage('This community is invite only.');
            return;
        }
        setIsProcessingJoin(true);
        try {
            if (joinMode === 'invite') {
                await acceptCommunityInvite({ communityId: community.id }, user.uid);
            } else {
                await joinCommunity(community.id, user.uid);
            }
        }
        catch (error) { console.error("Error joining community:", error); setModalMessage(error.message); }
        finally { setIsProcessingJoin(false); }
    };

    const handleJoinModalSubmit = async (value) => {
        try {
            if (joinModalMode === 'password') {
                await joinCommunityWithPassword(community.id, value);
                setModalMessage(`You joined ${community.name}.`);
            } else {
                await requestCommunityJoin(community.id, {
                    uid: user.uid,
                    username: userProfile?.username || user.displayName || 'Unknown User',
                }, value);
                setModalMessage('Your join request was sent.');
            }
        } catch (error) {
            setModalMessage(error.message);
            throw error;
        }
    };

    const handleWithdrawRequest = async () => {
        setIsProcessingJoin(true);
        try {
            await withdrawCommunityJoinRequest(community.id, user.uid);
            setModalMessage('Your join request was withdrawn.');
        } catch (error) {
            setModalMessage(error.message);
        } finally {
            setIsProcessingJoin(false);
        }
    };

    const handleLeave = () => {
        if (!user) return;
        // Bestätigung: Verlassen entfernt die Community-Rollen des Nutzers unwiderruflich.
        setConfirmation({
            message: `Leave "${community.name}"? You will lose your roles in this community.`,
            onConfirm: async () => {
                setIsProcessingJoin(true);
                try { await leaveCommunity(community.id, user.uid); }
                catch (error) { console.error("Error leaving community:", error); setModalMessage(error.message); }
                finally { setIsProcessingJoin(false); }
            }
        });
    };
    
    const themeColor = community?.themeColor || '#F97316';
    const joinActionLabel = isProcessingJoin
        ? 'Joining...'
        : community.joinMode === 'application'
            ? 'Apply to Join'
            : community.joinMode === 'password'
                ? 'Join with Password'
                : community.joinMode === 'invite'
                    ? (hasInvite ? 'Accept Invitation' : 'Invite Only')
                    : 'Join Community';

    if (infoPageRestricted && !infoAccessResolved) {
        return <div className="h-screen flex justify-center items-center"><Spinner /></div>;
    }

    if (!canViewInfoPage) {
        return (
            <div
                className="container mx-auto p-4 sm:p-8 min-h-[70vh] flex items-center justify-center"
                style={{ '--theme-color': themeColor }}
            >
                <div className="w-full max-w-xl rounded-2xl bg-white dark:bg-gray-800 shadow-xl p-8 text-center">
                    <div className="mx-auto mb-5 w-16 h-16 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                        <Icon path={ICONS.shieldCheck} className="w-9 h-9 community-text" />
                    </div>
                    <h1 className="text-3xl font-bold text-gray-800 dark:text-gray-100">
                        {community.name}
                    </h1>
                    <h2 className="mt-4 text-xl font-semibold text-gray-700 dark:text-gray-200">
                        Members-only community
                    </h2>
                    <p className="mt-2 text-gray-500 dark:text-gray-400">
                        Only members can open this community&apos;s info page.
                    </p>

                    <div className="mt-7 flex flex-col sm:flex-row justify-center gap-3">
                        <button
                            type="button"
                            onClick={() => navigate('/communitys')}
                            className="px-5 py-2.5 rounded-lg bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-800 dark:text-gray-100 font-semibold transition-colors"
                        >
                            Back to Community Hub
                        </button>

                        {user && !joinRequestPending && (
                            <button
                                type="button"
                                onClick={handleJoin}
                                disabled={
                                    isProcessingJoin ||
                                    (community.joinMode === 'invite' && !hasInvite)
                                }
                                className="px-5 py-2.5 rounded-lg community-bg hover:brightness-90 disabled:opacity-50 disabled:cursor-not-allowed text-white font-bold transition-all"
                            >
                                {joinActionLabel}
                            </button>
                        )}

                        {!user && (
                            <button
                                type="button"
                                onClick={() => navigate(
                                    `/login?redirect=${encodeURIComponent(buildCommunityPath(community.slug))}`
                                )}
                                className="px-5 py-2.5 rounded-lg community-bg hover:brightness-90 text-white font-bold transition-all"
                            >
                                Sign In
                            </button>
                        )}
                    </div>

                    {!user && (
                        <p className="mt-5 text-sm text-gray-500 dark:text-gray-400">
                            Sign in to request access or join this community.
                        </p>
                    )}

                    {user && joinRequestPending && (
                        <div className="mt-5">
                            <span className="inline-block bg-amber-100 text-amber-800 font-bold py-2 px-5 rounded-lg">
                                Application pending
                            </span>
                            <button
                                type="button"
                                onClick={handleWithdrawRequest}
                                disabled={isProcessingJoin}
                                className="block mx-auto mt-3 text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                            >
                                Withdraw application
                            </button>
                        </div>
                    )}
                </div>

                {joinModalMode && (
                    <CommunityJoinModal
                        communityName={community.name}
                        mode={joinModalMode}
                        allowMessage={community.allowApplicationMessage === true}
                        onClose={() => setJoinModalMode(null)}
                        onSubmit={handleJoinModalSubmit}
                    />
                )}
            </div>
        );
    }

    return (
        <div className="container mx-auto p-4 sm:p-8" style={{ '--theme-color': themeColor }}>
            <div className="mb-8">
                <div className="relative mb-4">
                    <img src={community.bannerImageUrl || 'https://placehold.co/1200x300/e2e8f0/64748b?text=Community+Banner'} alt={`${community.name} Banner`} className="w-full h-48 md:h-64 object-cover rounded-lg"/>
                    {community.isPartner === true && (
                        <OfficialPartnerBadge
                            communityName={community.name}
                            logoUrl={community.profileImageUrl}
                        />
                    )}
                    {SOCIAL_PLATFORMS.some(p => community.socialLinks?.[p.id]) && (
                        <div className="absolute bottom-3 right-3 flex gap-2">
                            {SOCIAL_PLATFORMS.filter(p => community.socialLinks?.[p.id]).map(platform => (
                                <a
                                    key={platform.id}
                                    href={community.socialLinks[platform.id]}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title={platform.label}
                                    className="w-9 h-9 rounded-full bg-black/60 community-bg-hover text-white flex items-center justify-center transition-colors shadow"
                                >
                                    <Icon path={platform.icon} solid={platform.solid} className="w-5 h-5" />
                                </a>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex flex-col md:flex-row justify-center items-center md:items-start gap-y-4 px-2">
                    <div className="flex flex-col sm:flex-row gap-2 order-2 md:order-1 w-56 flex-shrink-0">
                        <button 
                            onClick={() => navigate('/communitys')} 
                            className="flex items-center justify-center community-bg hover:brightness-90 text-white px-4 py-2 rounded-md transition-all font-semibold"
                        >
                            <Icon path={ICONS.arrowLeft} className="w-5 h-5 mr-2"/> Back to Hub
                        </button>
                        {isSiteAdmin && (
                            <>
                                <button
                                    type="button"
                                    onClick={handleTogglePartnerStatus}
                                    disabled={isUpdatingPartnerStatus}
                                    aria-pressed={community.isPartner === true}
                                    aria-label={community.isPartner === true ? 'Remove partner status' : 'Mark as partner community'}
                                    title={community.isPartner === true ? 'Remove from Partner Communitys' : 'Add to Partner Communitys'}
                                    className={`flex items-center justify-center px-3 py-2 rounded-md transition-all font-semibold disabled:opacity-50 disabled:cursor-not-allowed ${
                                        community.isPartner === true
                                            ? 'bg-yellow-500 hover:bg-yellow-600 text-white'
                                            : 'bg-gray-200 hover:bg-yellow-100 text-gray-700 dark:bg-gray-700 dark:hover:bg-yellow-900/40 dark:text-gray-200'
                                    }`}
                                >
                                    <Icon path={ICONS.star} solid={community.isPartner === true} className="w-5 h-5"/>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirmation({
                                        message: `Are you sure you want to permanently delete the "${community.name}" community?`,
                                        onConfirm: async () => {
                                            try {
                                                await deleteCommunityAsAdmin(community.id);
                                                setModalMessage("Community deleted successfully.");
                                                scheduleDataRefresh();
                                                navigate('/communitys');
                                            } catch (error) {
                                                setModalMessage(`Error deleting community: ${error.message}`);
                                            }
                                        }
                                    })}
                                    className="flex items-center justify-center bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md transition-all font-semibold"
                                >
                                    <Icon path={ICONS.trash} className="w-5 h-5"/>
                                </button>
                            </>
                        )}
                    </div>

                    <div className="text-center order-1 md:order-2 flex-grow">
                        <h1 className="text-4xl font-bold text-gray-800 dark:text-gray-100">{community.name}</h1>
                        <p className="text-gray-600 dark:text-gray-300 mt-2 max-w-2xl mx-auto">{community.description}</p>
                    </div>
                    
                    <div className="text-center order-3 md:order-3 md:text-right w-56 flex-shrink-0">
                        {user && !isCommunityOwner ? (
                            isMember ? (
                                <div className="flex flex-col items-center md:items-end gap-2">
                                    <button onClick={handleLeave} disabled={isProcessingJoin} className="bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white font-bold py-2 px-6 rounded-lg transition-colors">
                                        {isProcessingJoin ? 'Leaving...' : 'Leave Community'}
                                    </button>
                                    <label className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-300 cursor-pointer">
                                        <input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" checked={eventNotifyOn} onChange={handleToggleEventNotify} />
                                        Notify me about events
                                    </label>
                                </div>
                            ) : joinRequestPending ? (
                                <div className="flex flex-col items-center md:items-end gap-2">
                                    <span className="bg-amber-100 text-amber-800 font-bold py-2 px-5 rounded-lg">
                                        Application pending
                                    </span>
                                    <button
                                        type="button"
                                        onClick={handleWithdrawRequest}
                                        disabled={isProcessingJoin}
                                        className="text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
                                    >
                                        Withdraw application
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={handleJoin}
                                    disabled={isProcessingJoin || ((community.joinMode === 'invite') && !hasInvite)}
                                    className="bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-bold py-2 px-6 rounded-lg transition-colors"
                                >
                                    {isProcessingJoin
                                        ? 'Joining...'
                                        : community.joinMode === 'application'
                                            ? 'Apply to Join'
                                            : community.joinMode === 'password'
                                                ? 'Join with Password'
                                                : community.joinMode === 'invite'
                                                    ? (hasInvite ? 'Accept Invitation' : 'Invite Only')
                                                    : 'Join Community'}
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
                    <h2 className="text-2xl font-bold mb-4 text-gray-800 dark:text-gray-100">Pinned Creations</h2>
                    <div className="flex overflow-x-auto space-x-4 pb-4">
                        {pinnedCreations.map(creation => (
                            <div key={creation.id} className="w-64 flex-shrink-0">
                                <MiniCreationCard creation={creation} />
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div className="relative my-6">
                <div className="flex justify-center items-center">
                    <div className="relative flex items-center bg-gray-200 dark:bg-gray-700 rounded-full p-1 shadow-inner overflow-x-auto">
                        <div
                            ref={gliderRef}
                            className="absolute h-full community-bg rounded-full transition-all duration-300 ease-in-out"
                        />
                        {visibleTabs.map((tab, index) => (
                            <button
                                key={tab}
                                ref={el => tabRefs.current[index] = el}
                                onClick={() => setActiveTab(tab)}
                                className={`relative z-10 py-2 px-4 sm:px-8 rounded-full transition-colors duration-300 font-medium whitespace-nowrap ${ activeTab === tab ? 'text-white' : 'text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white'}`}
                            >
                                {tab}
                            </button>
                        ))}
                    </div>
                    {/* Desktop: + Button neben den Tabs */}
                    {user && isMember && canAddCreations && (
                        <button
                            onClick={() => setIsAddModalOpen(true)}
                            className="hidden sm:flex ml-3 w-11 h-11 items-center justify-center rounded-full community-bg text-white shadow hover:brightness-90 transition-all flex-shrink-0"
                            title="Add or remove your creations in this community"
                            aria-label="Manage your creations in this community"
                        >
                            <Icon path={ICONS.plus} className="w-6 h-6" />
                        </button>
                    )}
                    {user && isMember && canCreateEvents && activeTab === 'Events' && (
                        <button
                            onClick={() => navigate(`/community/${community.id}/create-event`)}
                            className="hidden sm:flex ml-3 h-11 items-center justify-center rounded-full bg-emerald-600 px-4 text-white shadow hover:bg-emerald-700 transition-colors flex-shrink-0"
                        >
                            Create Event
                        </button>
                    )}
                </div>
                {/* Mobile: + Button in eigener Zeile unter den Tabs */}
                {user && isMember && (canAddCreations || (canCreateEvents && activeTab === 'Events')) && (
                    <div className="flex sm:hidden justify-center mt-3">
                        <div className="flex gap-2">
                            {canAddCreations && (
                                <button
                                    onClick={() => setIsAddModalOpen(true)}
                                    className="w-11 h-11 flex items-center justify-center rounded-full community-bg text-white shadow hover:brightness-90 transition-all"
                                    title="Add or remove your creations in this community"
                                    aria-label="Manage your creations in this community"
                                >
                                    <Icon path={ICONS.plus} className="w-6 h-6" />
                                </button>
                            )}
                            {canCreateEvents && activeTab === 'Events' && (
                                <button
                                    onClick={() => navigate(`/community/${community.id}/create-event`)}
                                    className="h-11 rounded-full bg-emerald-600 px-4 font-semibold text-white shadow hover:bg-emerald-700"
                                >
                                    Create Event
                                </button>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {activeTab !== 'Videos' && (
            <div className="flex justify-center items-center mb-6 gap-4">
                <input
                    type="text"
                    placeholder={`Search in ${activeTab}...`}
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="w-full max-w-lg p-3 bg-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:placeholder-gray-400 rounded-full focus:outline-none focus:ring-2"
                    style={{'--tw-ring-color': themeColor}}
                />
                <div className="relative" ref={filterMenuRef}>
                    <button onClick={() => setIsFilterVisible(!isFilterVisible)} className="p-3 bg-gray-200 dark:bg-gray-700 rounded-full hover:bg-gray-300 dark:hover:bg-gray-600">
                        <Icon path={ICONS.filter} className="w-6 h-6 text-gray-700 dark:text-gray-200" />
                    </button>
                    {isFilterVisible && (
                        <div className="absolute right-0 mt-2 w-64 bg-white dark:bg-gray-800 rounded-lg shadow-xl z-20 border dark:border-gray-700 p-4">
                            {activeTab === 'Creations' && (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">Status</label>
                                        <select value={creationStatusFilter} onChange={(e) => setCreationStatusFilter(e.target.value)} className="w-full p-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100">
                                            <option value="all">All</option>
                                            <option value="wip">Work in Progress</option>
                                            <option value="finished">Finished</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">Platform</label>
                                        <select value={creationPlatformFilter} onChange={(e) => setCreationPlatformFilter(e.target.value)} className="w-full p-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100">
                                            <option value="all">All</option>
                                            <option value="pc">PC</option>
                                            <option value="console">Console</option>
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">Creator Rank</label>
                                        <select value={creationRankFilter} onChange={(e) => setCreationRankFilter(e.target.value)} className="w-full p-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100">
                                            <option value="all">All Ranks</option>
                                            {community?.ranks?.map(rank => (
                                                <option key={rank.name} value={rank.name.toLowerCase()}>{rank.name}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">Tag</label>
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
                                            <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-2">Required DLC</label>
                                            <select value={creationDlcFilter} onChange={(e) => setCreationDlcFilter(e.target.value)} className="w-full p-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100">
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
                                    <select value={memberRankFilter} onChange={(e) => setMemberRankFilter(e.target.value)} className="w-full p-2 border rounded-lg bg-white dark:bg-gray-700 dark:border-gray-600 dark:text-gray-100">
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
                    {visibleEvents.length > 0 ? (
                        <>
                            <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                                {visibleEvents.map(event => <EventCard key={event.id} event={event} community={community} userProfile={userProfile} showStatus={false} />)}
                            </div>
                            {loadingMoreEvents && <div className="text-center col-span-full p-8"><Spinner /></div>}
                            {!hasMoreEvents && events.length > 0 && (
                                <p className="text-center text-gray-500 dark:text-gray-400 mt-10 text-xl col-span-full">You've reached the end!</p>
                            )}
                        </>
                    ) : (
                        <div className="text-center text-gray-500 dark:text-gray-400 mt-10 py-10 bg-white dark:bg-gray-800 rounded-lg shadow-md">
                            <h3 className="text-2xl font-bold">No Events Yet</h3>
                            <p className="mt-2">This community hasn't scheduled any events.</p>
                        </div>
                    )}
                </div>
            )}

            {activeTab === 'Creations' && (
              <>
                <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {filteredContent.map(item => <CreationCard key={item.id} creation={item} onTagClick={(tag) => setCreationTagFilter(tag)} />)}
                </div>
                {filteredContent.length === 0 && (
                    <p className="text-center text-gray-500 dark:text-gray-400 mt-10 text-xl">No creations found.</p>
                )}
              </>
            )}

            {activeTab === 'Members' && (
              <>
                <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {filteredContent.map(item => <MemberCard key={item.id} member={item} community={community} />)}
                </div>
                {filteredContent.length === 0 && (
                    <p className="text-center text-gray-500 dark:text-gray-400 mt-10 text-xl">No members found.</p>
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
                    canApplyShowcase={canApplyShowcase}
                    onClose={() => setIsAddModalOpen(false)}
                    setModalMessage={setModalMessage}
                />
            )}
            {joinModalMode && (
                <CommunityJoinModal
                    communityName={community.name}
                    mode={joinModalMode}
                    allowMessage={community.allowApplicationMessage === true}
                    onClose={() => setJoinModalMode(null)}
                    onSubmit={handleJoinModalSubmit}
                />
            )}
        </div>
    );
};

export default CommunityDetailPage;
