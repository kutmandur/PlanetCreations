import React, { useState, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { db, auth } from '../../firebase/config';
import { collection, query, onSnapshot, doc, writeBatch, getDocs, where, updateDoc, getDoc, increment } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import ReportCard from '../cards/ReportCard';
import Spinner from '../ui/Spinner';
import BlacklistManager from '../management/BlacklistManager';
import TagManager from '../management/TagManager';
import CollaborationManager from '../management/CollaborationManager';

const ModerationPage = ({ setPopoverView, setModalMessage, setStrikeModal, setPasswordConfirm, setConfirmation, blacklist }) => {
    const TABS = useRef(['Reported Creations', 'Reported Users', 'Reported Content', 'Collaborations', 'Blacklist', 'Tag Library']).current;
    const [activeTab, setActiveTab] = useState(TABS[0]);
    const tabRefs = useRef([]);
    const gliderRef = useRef(null);
    const location = useLocation();

    // Deep-link support (e.g. from a notification): /moderation?tab=reported-users
    useEffect(() => {
        const tabSlug = new URLSearchParams(location.search).get('tab');
        if (!tabSlug) return;
        const match = TABS.find(t => t.toLowerCase().replace(/\s+/g, '-') === tabSlug);
        if (match) setActiveTab(match);
    }, [location.search, TABS]);
    
    const [reports, setReports] = useState([]);
    const [loadingReports, setLoadingReports] = useState(true);

    const [tags, setTags] = useState([]);
    const [loadingTags, setLoadingTags] = useState(true);

    useEffect(() => {
        const activeTabIndex = TABS.findIndex(tab => tab === activeTab);
        const activeTabNode = tabRefs.current[activeTabIndex];
        if (activeTabNode && gliderRef.current) {
            gliderRef.current.style.left = `${activeTabNode.offsetLeft}px`;
            gliderRef.current.style.width = `${activeTabNode.offsetWidth}px`;
        }
    }, [activeTab, TABS]);
    
    useEffect(() => {
        if (!activeTab.startsWith('Reported')) return;
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
    }, [activeTab, setModalMessage]);
    
    useEffect(() => {
        if (activeTab !== 'Tag Library') return;
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
    }, [activeTab, setModalMessage]);
    
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
        if (activeTab.startsWith('Reported')) {
            if (loadingReports) return <Spinner />;
            const filterType = activeTab === 'Reported Creations' ? 'creation' :
                (activeTab === 'Reported Users' ? 'user' : 'content');
            const filteredReports = reports.filter(item => filterType === 'content' ?
                !['creation', 'user'].includes(item.type) : item.type === filterType);
            if (filteredReports.length === 0) {
                return <p className="text-center text-gray-500 mt-10">No reported {filterType}s found.</p>;
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

        if (activeTab === 'Blacklist') {
            return <BlacklistManager blacklist={blacklist} setModalMessage={setModalMessage} />;
        }

        if (activeTab === 'Tag Library') {
            if (loadingTags) return <Spinner />;
            return <TagManager tags={tags} setModalMessage={setModalMessage} />;
        }
        
        return null;
    };

    return (
        <div className="container mx-auto p-4 sm:p-8">
            <h1 className="text-3xl font-bold mb-6 text-gray-800">Moderation Panel</h1>
            <div className="relative flex justify-center my-6">
                <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner overflow-x-auto">
                    <div ref={gliderRef} className="absolute h-full bg-yellow-500 rounded-full transition-all duration-300 ease-in-out" />
                    {TABS.map((tab, index) => (
                        <button
                            key={tab}
                            ref={el => tabRefs.current[index] = el}
                            onClick={() => setActiveTab(tab)}
                            className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 text-sm sm:text-base font-medium whitespace-nowrap ${ activeTab === tab ? 'text-white' : 'text-gray-600 hover:text-black'}`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
            </div>
            <div className="py-6">
                {renderContent()}
            </div>
        </div>
    );
};

export default ModerationPage;
