import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
    collection,
    doc,
    getDoc,
    limit,
    onSnapshot,
    query,
    where,
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { fetchCommunityIndex } from '../../firebase/communityIndexService';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';
import MemberManager from '../management/MemberManager';
import CreationManager from '../management/CreationManager';
import CommunitySettingsManager from '../management/CommunitySettingsManager';
import ShowcaseManager from '../management/ShowcaseManager';
import EventsManager from '../management/EventsManager';
import JoinRequestsManager from '../management/JoinRequestsManager';
import { getCommunityManagerTabs } from '../../utils/communityManagerTabs';
import {
    ALL_COMMUNITY_PERMISSIONS,
    getEffectiveCommunityPermissions,
} from '../../utils/communityPermissions';

const CommunityManagerPage = ({ setPasswordConfirm, setModalMessage, setConfirmation, blacklist, userProfile, setPopoverView }) => {
    const { id: communityId } = useParams();
    const [community, setCommunity] = useState(null);
    const [loading, setLoading] = useState(true);
    const [members, setMembers] = useState([]);
    const [creations, setCreations] = useState([]);
    const [hasPendingJoinRequests, setHasPendingJoinRequests] = useState(false);
    const managerMemberInfo = members.find(member => member.id === userProfile?.uid);
    const managerRoles = managerMemberInfo?.roles || [];
    const isSiteStaff = ['admin', 'moderator'].includes(userProfile?.role);
    const managerPermissions = useMemo(
        () => isSiteStaff
            ? { ...ALL_COMMUNITY_PERMISSIONS }
            : getEffectiveCommunityPermissions(community, managerMemberInfo),
        [community, isSiteStaff, managerMemberInfo]
    );
    const canManageSettings =
        userProfile?.role === 'admin' ||
        community?.ownerId === userProfile?.uid ||
        managerRoles.includes('owner');

    const tabs = useMemo(
        () => getCommunityManagerTabs(
            community,
            hasPendingJoinRequests,
            managerPermissions,
            canManageSettings
        ),
        [
            community,
            hasPendingJoinRequests,
            managerPermissions,
            canManageSettings,
        ]
    );
    const [activeTab, setActiveTab] = useState('Creations');
    const tabRefs = useRef([]);
    const [gliderStyle, setGliderStyle] = useState({});
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        const requestedTab = new URLSearchParams(location.search).get('tab');
        if (requestedTab && tabs.includes(requestedTab)) {
            setActiveTab(requestedTab);
        }
    }, [location.search, tabs]);

    useEffect(() => {
        if (!tabs.includes(activeTab)) {
            setActiveTab(tabs[0] || 'Creations');
        }
    }, [activeTab, tabs]);

    useEffect(() => {
        let isMounted = true;
        if (!communityId) {
            navigate('/communitys');
            return;
        }

        setLoading(true);
        const communityRef = doc(db, 'communitys', communityId);
        const unsubscribeCommunity = onSnapshot(communityRef, (docSnap) => {
            if (isMounted) {
                if (docSnap.exists()) {
                    setCommunity({ id: docSnap.id, ...docSnap.data() });
                } else {
                    setModalMessage("Community not found.");
                    navigate('/communitys');
                }
            }
        });

        return () => {
            isMounted = false;
            unsubscribeCommunity();
        };
    }, [communityId, navigate, setModalMessage]);

    useEffect(() => {
        if (!community) return;

        let isMounted = true;

        const membersRef = collection(db, 'communitys', communityId, 'members');
        const unsubscribeMembers = onSnapshot(membersRef, async (snapshot) => {
            const memberData = await Promise.all(snapshot.docs.map(async (memberDoc) => {
                const profileRef = doc(db, 'profiles', memberDoc.id);
                const profileSnap = await getDoc(profileRef);
                return { id: memberDoc.id, ...memberDoc.data(), ...(profileSnap.exists() ? profileSnap.data() : {}) };
            }));
            if (isMounted) {
                setMembers(memberData);
            }
        });

        return () => {
            isMounted = false;
            unsubscribeMembers();
        };
    }, [community, communityId]);

    useEffect(() => {
        if (!managerPermissions.manageJoinRequests) {
            setHasPendingJoinRequests(false);
            return undefined;
        }
        const pendingRequestsQuery = query(
            collection(db, 'communitys', communityId, 'joinRequests'),
            where('status', '==', 'pending'),
            limit(1)
        );
        const unsubscribe = onSnapshot(
            pendingRequestsQuery,
            snapshot => setHasPendingJoinRequests(!snapshot.empty),
            error => {
                console.error('Could not determine join-request tab visibility:', error);
                setHasPendingJoinRequests(false);
            }
        );
        return unsubscribe;
    }, [communityId, managerPermissions.manageJoinRequests]);

    // Creations kommen aus dem Community-Index (1 Read). Mutationen der Manager
    // aktualisieren den lokalen State direkt; der Index zieht per Trigger nach.
    const { data: indexCreations, isError: indexError } = useQuery({
        queryKey: ['communityIndex', communityId],
        queryFn: () => fetchCommunityIndex(communityId),
        enabled: !!community,
        staleTime: 60 * 1000,
    });

    useEffect(() => {
        // Ohne Fehlerbehandlung bliebe der Spinner bei einem Index-Query-Fehler
        // für immer stehen (indexCreations bleibt undefined).
        if (indexError) { setLoading(false); return; }
        if (!indexCreations || !community) return;
        const communityRanks = community.ranks || [];
        setCreations(indexCreations.map(creation => ({
            ...creation,
            creatorRanks: (creation.creatorRoles || [])
                .map(roleName => communityRanks.find(r => r.name.toLowerCase() === roleName.toLowerCase()))
                .filter(Boolean),
        })));
        setLoading(false);
    }, [indexCreations, community, indexError]);

    useEffect(() => {
        if (!loading) {
            setTimeout(() => {
                const activeTabIndex = tabs.findIndex(tab => tab === activeTab);
                const activeTabRef = tabRefs.current[activeTabIndex];
                if (activeTabRef) {
                    setGliderStyle({ left: activeTabRef.offsetLeft, width: activeTabRef.offsetWidth });
                }
            }, 50);
        }
    }, [activeTab, tabs, loading]);

    const getHighestRankWeight = (memberRoles, allRanks) => {
        if (!memberRoles || memberRoles.length === 0) return 99;
        const weights = memberRoles.map(role => {
            const rank = allRanks.find(r => r.name.toLowerCase() === role.toLowerCase());
            return rank ? rank.weight : 99;
        });
        return Math.min(...weights);
    };

    if (loading || !community) {
        return <div className="h-screen flex justify-center items-center"><Spinner /></div>;
    }
    
    const themeColor = community.themeColor || '#A855F7';
    
    const currentUserMemberInfo = managerMemberInfo;
    const currentUserRoles = currentUserMemberInfo?.roles || [];
    const isOwner = currentUserRoles.includes('owner');
    const currentUserRankWeight =
        userProfile?.role === 'admin'
            ? -1
            : userProfile?.role === 'moderator'
                ? 1
                : getHighestRankWeight(currentUserRoles, community.ranks || []);

    const renderTabContent = () => {
        switch (activeTab) {
            case 'Creations': 
                return <CreationManager 
                            creations={creations} 
                            setCreations={setCreations}
                            communityId={communityId}
                            setModalMessage={setModalMessage}
                            ranks={community.ranks || []}
                            setPopoverView={setPopoverView}
                            blacklist={blacklist}
                        />;
            case 'Members': 
                return <MemberManager
                            members={members}
                            ranks={community.ranks || []}
                            communityId={communityId}
                            community={community}
                            setPopoverView={setPopoverView}
                            setModalMessage={setModalMessage}
                            setConfirmation={setConfirmation}
                            currentUserRankWeight={currentUserRankWeight}
                            currentUserId={userProfile?.uid}
                            canManageMembers={managerPermissions.manageMembers}
                            canManageInvitations={managerPermissions.manageInvitations}
                            canManageProtectedRanks={
                                isOwner || userProfile?.role === 'admin'
                            }
                        />;
            case 'Requests':
                return <JoinRequestsManager
                            community={community}
                            setModalMessage={setModalMessage}
                        />;
            case 'Events':
                return <EventsManager
                            community={community}
                            userProfile={userProfile}
                            setModalMessage={setModalMessage}
                            canCreateEvents={managerPermissions.createEvents}
                        />;
            case 'Showcases':
                return <ShowcaseManager
                            creations={creations}
                            setCreations={setCreations}
                            community={community}
                            setCommunity={setCommunity}
                            communityId={communityId}
                            setModalMessage={setModalMessage}
                            setPopoverView={setPopoverView}
                            setConfirmation={setConfirmation}
                            blacklist={blacklist}
                        />;
            case 'Settings':
                return <CommunitySettingsManager
                            community={community}
                            members={members}
                            userProfile={userProfile}
                            blacklist={blacklist}
                            setModalMessage={setModalMessage}
                            setPasswordConfirm={setPasswordConfirm}
                            isOwner={isOwner}
                            onTransferComplete={() => navigate('/communitys')}
                            onDeleted={() => navigate('/communitys')}
                        />;
            default: return null;
        }
    };

    return (
        <div className="container mx-auto p-4 sm:p-8" style={{ '--theme-color': themeColor }}>
            <div className="relative text-center mb-8">
                <div className="flex flex-wrap justify-between items-start gap-2 mb-4 lg:mb-0 lg:absolute lg:inset-x-0 lg:top-0 lg:pointer-events-none">
                    <button
                        onClick={() => navigate(`/community/${community.slug}`)}
                        className="flex items-center justify-center bg-[--theme-color] hover:brightness-90 text-white font-semibold py-2 px-4 rounded-lg transition-all lg:pointer-events-auto"
                    >
                        <Icon path={ICONS.arrowLeft} className="w-5 h-5 mr-2" />
                        Back to Community
                    </button>
                </div>
                <div className="max-w-2xl mx-auto lg:px-48">
                    <h1 className="text-3xl sm:text-4xl font-bold text-gray-800">Manage Community</h1>
                    <h2 className="text-xl sm:text-2xl text-gray-600">{community.name}</h2>
                </div>
            </div>

            <div className="relative flex justify-center my-6">
                <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner overflow-x-auto">
                    <div className={`absolute h-full bg-[--theme-color] rounded-full transition-all duration-500 ease-in-out`} style={gliderStyle} />
                    {tabs.map((tab, index) => (
                        <button
                            key={tab}
                            ref={el => tabRefs.current[index] = el}
                            onClick={() => setActiveTab(tab)}
                            className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 font-medium whitespace-nowrap ${ activeTab === tab ? 'text-white' : 'text-gray-600 hover:text-black'}`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
            </div>

            <div className="mt-8">
                {renderTabContent()}
            </div>
        </div>
    );
};

export default CommunityManagerPage;
