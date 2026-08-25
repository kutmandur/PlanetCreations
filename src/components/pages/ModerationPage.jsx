import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { db, auth } from '../../firebase/config';
import { collection, query, onSnapshot, doc, writeBatch, getDocs, where, updateDoc, getDoc, increment } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import ReportCard from '../cards/ReportCard';
import Spinner from '../ui/Spinner';
import BlacklistManager from '../management/BlacklistManager';
import TagManager from '../management/TagManager';
import CollaborationManager from '../management/CollaborationManager';
import PillTabs from '../ui/PillTabs';

const MODERATION_TABS = ['Reports', 'Collaborations', 'Content Settings'];
const REPORT_TABS = ['Creations', 'Users', 'Content'];
const CONTENT_SETTINGS_TABS = ['Blacklist', 'Tag Library'];

const MODERATION_ROUTE_TARGETS = Object.freeze({
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
    
    const [reports, setReports] = useState([]);
    const [loadingReports, setLoadingReports] = useState(true);

    const [tags, setTags] = useState([]);
    const [loadingTags, setLoadingTags] = useState(true);

    const countReports = predicate => reports.reduce((total, reportGroup) => (
        predicate(reportGroup) ? total + (reportGroup.reports?.length || 0) : total
    ), 0);
    const reportCounts = {
        Creations: countReports(report => report.type === 'creation'),
        Users: countReports(report => report.type === 'user'),
        Content: countReports(report => !['creation', 'user'].includes(report.type)),
    };
    const totalReportCount = reportCounts.Creations + reportCounts.Users + reportCounts.Content;

    useEffect(() => {
        let isMounted = true;
        setLoadingReports(true);
        const q = query(collection(db, 'reports'));
        const unsubscribe = onSnapshot(q, (snapshot) => {
            const allReports = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            const grouped = allReports.reduce((acc, report) => {
                const { targetId, targetType, targetTitle, targetPath, markerId, reason, timestamp, reporterId } = report;
                const groupKey = `${targetType}:${targetId}`;
                if (!acc[groupKey]) {
                    acc[groupKey] = { id: targetId, type: targetType, title: targetTitle, targetPath, reports: [] };
                }
                acc[groupKey].reports.push({ reason, timestamp, reporterId, markerId });
                return acc;
            }, {});
            if (isMounted) {
                setReports(Object.values(grouped));
                setLoadingReports(false);
            }
        }, (error) => {
            console.error("Error fetching reports:", error);
            if(isMounted) {
                setModalMessage("Failed to load reports.");
                setLoadingReports(false);
            }
        });
        return () => { isMounted = false; unsubscribe(); };
    }, [setModalMessage]);
    
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
        const clearReportsAndMarkers = async (batch) => {
            const reportsQuery = query(collection(db, 'reports'), where('targetId', '==', targetId));
            const reportsSnapshot = await getDocs(reportsQuery);
            reportsSnapshot.forEach(reportDoc => {
                const report = reportDoc.data();
                if (report.targetType !== targetType) return;
                const reporterId = report.reporterId;
                if (reporterId) {
                    const reportMarkerRef = doc(db, 'users', reporterId, 'reportedItems', report.markerId || targetId);
                    batch.delete(reportMarkerRef);
                }
                batch.delete(reportDoc.ref);
            });
        };

        if (action === 'resolve') {
            try {
                const batch = writeBatch(db);
                await clearReportsAndMarkers(batch);
                await batch.commit();
                setModalMessage("Report resolved and all user flags have been cleared.");
            } catch (error) {
                setModalMessage(`Error resolving report: ${error.message}`);
            }
        }

        if (action === 'delete' || action === 'ban') {
            setPasswordConfirm({
                message: `To ${action} this item, please confirm with your password. This action is permanent.`,
                onConfirm: async (password) => {
                    const user = auth.currentUser;
                    try {
                        const credential = EmailAuthProvider.credential(user.email, password);
                        await reauthenticateWithCredential(user, credential);
                        
                        const batch = writeBatch(db);
                        await clearReportsAndMarkers(batch);

                        if (targetType === 'creation' && action === 'delete') {
                            const creationRef = doc(db, 'creations', targetId);
                            batch.delete(creationRef);
                        } else if (targetType === 'user' && action === 'ban') {
                            const userRef = doc(db, 'users', targetId);
                            batch.update(userRef, { role: 'banned' });
                            const profileRef = doc(db, 'profiles', targetId);
                            batch.update(profileRef, { role: 'banned' });
                        }

                        await batch.commit();
                        setModalMessage(`Item successfully ${action}d and reports cleared.`);
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
                        
                        const userRef = doc(db, 'users', userToStrikeId);
                        await updateDoc(userRef, { strikes: increment(1) });
                        
                        const batch = writeBatch(db);
                        await clearReportsAndMarkers(batch);
                        await batch.commit();

                        setModalMessage(`Strike issued successfully and reports cleared.`);
                    } catch (error) {
                        setModalMessage(`Error issuing strike: ${error.message}`);
                    }
                }
            });
        }
    };

    const renderContent = () => {
        if (activeTab === 'Reports') {
            if (loadingReports) return <Spinner />;
            const filterType = reportSubTab === 'Creations' ? 'creation' :
                (reportSubTab === 'Users' ? 'user' : 'content');
            const filteredReports = reports.filter(item => filterType === 'content' ?
                !['creation', 'user'].includes(item.type) : item.type === filterType);
            if (filteredReports.length === 0) {
                const emptyLabel = reportSubTab === 'Content' ? 'content' : reportSubTab.toLowerCase();
                return <p className="text-center text-gray-500 mt-10">No reported {emptyLabel} found.</p>;
            }
            return (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                    {filteredReports.map(item => (
                        <ReportCard key={item.id} item={item} onAction={handleAction} setPopoverView={setPopoverView} />
                    ))}
                </div>
            );
        }

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
