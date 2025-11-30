import React, { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { doc, onSnapshot, collection, getDocs, getDoc, query, where } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { cacheCreations, cacheCommunityCreationList, cacheCommunityCreationMeta } from '../../utils/creationCache';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';
import EditCommunityForm from '../management/EditCommunityForm';
import MemberManager from '../management/MemberManager';
import CreationManager from '../management/CreationManager';
import CommunityCardEditor from '../management/CommunityCardEditor';
import DiscordManager from '../management/DiscordManager';
import CommunitySettingsManager from '../management/CommunitySettingsManager';
import ShowcaseManager from '../management/ShowcaseManager';

const CommunityManagerPage = ({ setPasswordConfirm, setModalMessage, setConfirmation, blacklist, userProfile, setPopoverView }) => {
    const { id: communityId } = useParams();
    const queryClient = useQueryClient();
    const [community, setCommunity] = useState(null);
    const [loading, setLoading] = useState(true);
    const [isEditing, setIsEditing] = useState(false);
    const [members, setMembers] = useState([]);
    const [creations, setCreations] = useState([]);

    const TABS = useRef(['Creations', 'Members', 'Showcases', 'Card Editor', 'Discord', 'Settings']).current;
    const [activeTab, setActiveTab] = useState('Creations');
    const tabRefs = useRef([]);
    const [gliderStyle, setGliderStyle] = useState({});
    const navigate = useNavigate();

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

        const creationsQuery = query(collection(db, 'creations'), where('communityIds', 'array-contains', communityId));
        const unsubscribeCreations = onSnapshot(creationsQuery, async (snapshot) => {
            const creationData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            const linksRef = collection(db, 'communitys', communityId, 'creations');
            const membersRef = collection(db, 'communitys', communityId, 'members');

            const [linksSnapshot, membersSnapshot] = await Promise.all([getDocs(linksRef), getDocs(membersRef)]);

            const linksMap = new Map(linksSnapshot.docs.map(doc => [doc.id, doc.data()]));
            const memberRolesMap = new Map(membersSnapshot.docs.map(doc => [doc.id, doc.data().roles || []]));

            const creationsWithDetails = creationData.map(creation => {
                const creatorRoles = memberRolesMap.get(creation.userId) || [];
                const communityRanks = community.ranks || [];
                const linkData = linksMap.get(creation.id) || {};

                const creatorRanks = creatorRoles.map(roleName => {
                    return communityRanks.find(r => r.name.toLowerCase() === roleName.toLowerCase());
                }).filter(Boolean);

                return {
                    ...creation,
                    pinned: linkData.pinned || false,
                    showcaseVideoUrl: linkData.showcaseVideoUrl || null,
                    markedForShowcase: linkData.markedForShowcase || false,
                    showcaseNote: linkData.showcaseNote || '',
                    showcaseGroupId: linkData.showcaseGroupId || null,
                    creatorRanks: creatorRanks
                };
            });

            // Basis-Creations im zentralen Cache speichern (ohne Community-spezifische Felder)
            cacheCreations(queryClient, creationData);
            // Community-Liste cachen
            cacheCommunityCreationList(queryClient, communityId, creationData.map(c => c.id));
            // Community-Metadaten cachen
            const metaData = {};
            linksSnapshot.docs.forEach(doc => {
                metaData[doc.id] = doc.data();
            });
            cacheCommunityCreationMeta(queryClient, communityId, metaData);

            if (isMounted) {
                setCreations(creationsWithDetails);
                setLoading(false);
            }
        });

        return () => {
            isMounted = false;
            unsubscribeMembers();
            unsubscribeCreations();
        };
    }, [community, communityId, queryClient]);

    useEffect(() => {
        if (!loading) {
            setTimeout(() => {
                const activeTabIndex = TABS.findIndex(tab => tab === activeTab);
                const activeTabRef = tabRefs.current[activeTabIndex];
                if (activeTabRef) {
                    setGliderStyle({ left: activeTabRef.offsetLeft, width: activeTabRef.offsetWidth });
                }
            }, 50);
        }
    }, [activeTab, TABS, loading]);

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
    
    const currentUserMemberInfo = members.find(m => m.id === userProfile?.uid);
    const currentUserRoles = currentUserMemberInfo?.roles || [];
    const isOwner = currentUserRoles.includes('owner');
    const isModerator = currentUserRoles.includes('moderator');
    const currentUserRankWeight = getHighestRankWeight(currentUserRoles, community.ranks || []);

    if (isEditing) {
        return <EditCommunityForm communityToEdit={community} setPasswordConfirm={setPasswordConfirm} setModalMessage={setModalMessage} onCancel={() => setIsEditing(false)} blacklist={blacklist} userProfile={userProfile} />;
    }

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
                            setPopoverView={setPopoverView}
                            setModalMessage={setModalMessage}
                            setConfirmation={setConfirmation}
                            currentUserRankWeight={currentUserRankWeight}
                            currentUserId={userProfile?.uid}
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
                        />;
            case 'Card Editor':
                return <CommunityCardEditor community={community} setModalMessage={setModalMessage} />;
            case 'Discord':
                return <DiscordManager community={community} setModalMessage={setModalMessage} setConfirmation={setConfirmation} />;
            case 'Settings': 
                return <CommunitySettingsManager community={community} setModalMessage={setModalMessage} />;
            default: return null;
        }
    };

    return (
        <div className="container mx-auto p-4 sm:p-8" style={{ '--theme-color': themeColor }}>
            <div className="relative text-center mb-8">
                <div className="max-w-2xl mx-auto">
                    <h1 className="text-4xl font-bold text-gray-800">Manage Community</h1>
                    <h2 className="text-2xl text-gray-600">{community.name}</h2>
                </div>
                {(isOwner || isModerator) && (
                    <div className="absolute top-0 right-0">
                        <button 
                            onClick={() => setIsEditing(true)}
                            className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg flex items-center"
                        >
                            <Icon path={ICONS.edit} className="w-5 h-5 mr-2" />
                            Edit Community
                        </button>
                    </div>
                )}
            </div>

            <div className="relative flex justify-center my-6">
                <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner">
                    <div className={`absolute h-full bg-[--theme-color] rounded-full transition-all duration-500 ease-in-out`} style={gliderStyle} />
                    {TABS.map((tab, index) => (
                        <button 
                            key={tab} 
                            ref={el => tabRefs.current[index] = el} 
                            onClick={() => setActiveTab(tab)} 
                            className={`relative z-10 py-2 px-6 rounded-full transition-colors duration-300 font-medium ${ activeTab === tab ? 'text-white' : 'text-gray-600 hover:text-black'}`}
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