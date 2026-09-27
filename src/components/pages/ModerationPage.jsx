import {getFunctions,httpsCallable} from 'firebase/functions';
import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { db, auth } from '../../firebase/config';
import { collection, query, onSnapshot, doc, writeBatch, getDocs, where, updateDoc, getDoc, increment } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import ModerationIndexPanel from '../management/ModerationIndexPanel';
import Spinner from '../ui/Spinner';
import BlacklistManager from '../management/BlacklistManager';
import TagManager from '../management/TagManager';
import CollaborationManager from '../management/CollaborationManager';
import PillTabs from '../ui/PillTabs';
import AccountModerationManager from '../management/AccountModerationManager';

const MODERATION_TABS = ['Reports', 'Accounts', 'Collaborations', 'Content Settings'];
const REPORT_TABS = ['Creations', 'Users', 'Content'];
const CONTENT_SETTINGS_TABS = ['Blacklist', 'Tag Library'];

const MODERATION_ROUTE_TARGETS = Object.freeze({
    accounts: { tab: 'Accounts' },
    reports: { tab: 'Reports', section: 'Creations' },
    'reported-creations': { tab: 'Reports', section: 'Creations' },
    'reported-users': { tab: 'Reports', section: 'Users' },
    'reported-content': { tab: 'Reports', section: 'Content' },
    collaborations: { tab: 'Collaborations' },
    'content-settings': { tab: 'Content Settings', section: 'Blacklist' },
    blacklist: { tab: 'Content Settings', section: 'Blacklist' },
    'tag-library': { tab: 'Content Settings', section: 'Tag Library' },
});

const MODERATION_SECTION_TARGETS = Object.freeze({
    Reports: {
        creations: 'Creations',
        users: 'Users',
        content: 'Content',
    },
    'Content Settings': {
        blacklist: 'Blacklist',
        tags: 'Tag Library',
        'tag-library': 'Tag Library',
    },
});

const ModerationPage = ({ setPopoverView, setModalMessage, setStrikeModal, setPasswordConfirm, setConfirmation, blacklist }) => {
    const TABS = MODERATION_TABS;
    const [activeTab, setActiveTab] = useState(TABS[0]);
    const [reportSubTab, setReportSubTab] = useState('Creations');
    const [contentSettingsSubTab, setContentSettingsSubTab] = useState('Blacklist');
    const location = useLocation();

    // Consolidated navigation plus backwards-compatible links to the old tabs.
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const tabSlug = params.get('tab');
        if (!tabSlug) return;
        const target = MODERATION_ROUTE_TARGETS[tabSlug];
        if (!target) return;

        setActiveTab(target.tab);
        const requestedSection = MODERATION_SECTION_TARGETS[target.tab]?.[params.get('section')];
        const section = requestedSection || target.section;
        if (target.tab === 'Reports' && section) setReportSubTab(section);
        if (target.tab === 'Content Settings' && section) setContentSettingsSubTab(section);
    }, [location.search]);
    
    const [reportCounts,setReportCounts]=useState({Creations:0,Users:0,Content:0});
    const [tags,setTags]=useState([]),[loadingTags,setLoadingTags]=useState(true);
    const totalReportCount=Object.values(reportCounts).reduce((sum,count)=>sum+count,0);
    useEffect(()=>{
        if(activeTab!=='Reports')return;
        return onSnapshot(collection(db,'moderationIndexState'),snapshot=>setReportCounts(Object.fromEntries(['Creations','Users','Content'].map(category=>[category,snapshot.docs.find(doc=>doc.id===category)?.data().reportCount||0]))),()=>setModalMessage('Moderation index counts could not be loaded.'));
    },[activeTab,setModalMessage]);

    useEffect(() => {
        if (activeTab !== 'Content Settings' || contentSettingsSubTab !== 'Tag Library') return;
        let isMounted = true;
        setLoadingTags(true);
        const tagsQuery = query(collection(db, 'tags'));
        const unsubscribe = onSnapshot(tagsQuery, (snapshot) => {
            if(isMounted) {
                const tagsData = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()}));
                setTags(tagsData);
                setLoadingTags(false);
            }
        }, (error) => {
            console.error("Error fetching tags:", error);
            if (isMounted) {
                setModalMessage("Failed to load tags.");
                setLoadingTags(false);
            }
        });
        return () => { isMounted = false; unsubscribe(); };
    }, [activeTab, contentSettingsSubTab, setModalMessage]);
    
    const handleAction = async (action, targetId, targetType) => {
        if (action === 'delete') {
            setPasswordConfirm({
                message: `To ${action} this item, please confirm with your password. This action is permanent.`,
                onConfirm: async (password) => {
                    const user = auth.currentUser;
                    try {
                        const credential = EmailAuthProvider.credential(user.email, password);
                        await reauthenticateWithCredential(user, credential);
                        
                        const batch = writeBatch(db);


                        if (targetType === 'creation' && action === 'delete') {
                            const cases = await getDocs(query(collection(db, 'contentReviews'), where('targetId', '==', targetId)));
                            if (cases.docs.some(entry => entry.data().targetType === 'creation' && Object.keys(entry.data().original || {}).length)) {
                                throw new Error('Restore withheld content before permanently deleting this creation.');
                            }
                            const targetReports = await getDocs(query(collection(db, 'reports'), where('targetId', '==', targetId)));
                            targetReports.docs.forEach(entry => {
                                if (entry.data().targetType === 'creation') batch.update(entry.ref, {status: 'deleted'});
                            });
                            const creationRef = doc(db, 'creations', targetId);
                            batch.delete(creationRef);
                        }

                        await batch.commit();
                        setModalMessage(`Item successfully ${action}d. Review history was retained.`);
                    } catch (error) {
                         setModalMessage(`Error: ${error.message}`);
                    }
                }
            });
        }

        if (action === 'strike') {
            setStrikeModal({
                targetId: targetId,
                targetType: targetType,
                onConfirm: async (reason) => {
                    try {
                        let userToStrikeId = targetId;
                        if (targetType === 'creation') {
                            const creationSnap = await getDoc(doc(db, 'creations', targetId));
                            if (creationSnap.exists()) {
                                userToStrikeId = creationSnap.data().userId;
                            } else {
                                throw new Error("Creation not found.");
                            }
                        }

                        if (!userToStrikeId) {
                            throw new Error("Could not find user associated with this item.");
                        }
                        
                        await httpsCallable(getFunctions(),'moderateAccount')({targetUserId:userToStrikeId,action:'warn',reason});
                        
                        setModalMessage('Strike issued successfully. Reports and review history remain unchanged.');
                    } catch (error) {
                        setModalMessage(`Error issuing strike: ${error.message}`);
                        throw error;
                    }
                }
            });
        }
    };

    const renderContent = () => {
        if(activeTab==='Accounts')return <AccountModerationManager/>;
        if(activeTab==='Reports')return <ModerationIndexPanel key={reportSubTab} category={reportSubTab} onAction={handleAction} setPopoverView={setPopoverView}/>;

        if (activeTab === 'Collaborations') {
            return <CollaborationManager setModalMessage={setModalMessage} setConfirmation={setConfirmation} />;
        }

        if (activeTab === 'Content Settings') {
            if (contentSettingsSubTab === 'Blacklist') {
                return <BlacklistManager blacklist={blacklist} setModalMessage={setModalMessage} />;
            }
            if (loadingTags) return <Spinner />;
            return <TagManager tags={tags} setModalMessage={setModalMessage} />;
        }
        
        return null;
    };

    return (
        <div className="container mx-auto p-4 sm:p-8">
            <h1 className="text-3xl font-bold mb-6 text-gray-800">Moderation Panel</h1>
            <PillTabs
                tabs={TABS}
                value={activeTab}
                onChange={setActiveTab}
                counts={{ Reports: totalReportCount }}
                accentClass="bg-yellow-500"
                ariaLabel="Moderation sections"
                className="my-6"
            />
            <div className="py-6">
                {activeTab === 'Reports' && (
                    <PillTabs
                        tabs={REPORT_TABS}
                        value={reportSubTab}
                        onChange={setReportSubTab}
                        counts={reportCounts}
                        ariaLabel="Report categories"
                        className="mb-8"
                    />
                )}
                {activeTab === 'Content Settings' && (
                    <PillTabs
                        tabs={CONTENT_SETTINGS_TABS}
                        value={contentSettingsSubTab}
                        onChange={setContentSettingsSubTab}
                        ariaLabel="Content settings sections"
                        className="mb-8"
                    />
                )}
                {renderContent()}
            </div>
        </div>
    );
};

export default ModerationPage;
