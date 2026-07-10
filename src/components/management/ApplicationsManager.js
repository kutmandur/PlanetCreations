import React, { useState, useMemo, useRef, useEffect } from 'react';
import { db } from '../../firebase/config';
import { doc, setDoc } from 'firebase/firestore';
import CreationShowcaseCard from '../cards/CreationShowcaseCard';
import ShowcaseNoteModal from '../modals/ShowcaseNoteModal';
import { creationMatchesFilters } from './CommunityFilterBar';

// Liste aller Showcase-Bewerbungen (appliedForShowcase auf dem Link-Doc).
// Eine Bewerbung verschwindet aus der Liste, sobald sie markiert, einer
// Gruppe zugeordnet oder bereits showcased ist — das app-Flag bleibt aber
// bestehen, damit sich eine Creation nur einmal bewerben kann.
// Suche/Filter kommen als filterState vom ShowcaseManager (gemeinsame Leiste).
const ApplicationsManager = ({ creations, setCreations, community, setModalMessage, setPopoverView, blacklist, filterState }) => {
    const [showcaseModal, setShowcaseModal] = useState(null);
    const [groupMenu, setGroupMenu] = useState(null);
    const groupMenuRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (groupMenuRef.current && !groupMenuRef.current.contains(event.target)) setGroupMenu(null);
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const applications = useMemo(() =>
        creations.filter(c =>
            c.appliedForShowcase &&
            !c.markedForShowcase &&
            !c.showcaseVideoUrl &&
            !c.showcaseGroupId
        ), [creations]);

    const filteredApplications = useMemo(() => {
        return applications
            .filter(creation => {
                if (filterState.status !== 'all' && creation.status !== filterState.status) return false;
                return creationMatchesFilters(creation, filterState);
            })
            .sort((a, b) => (a.appliedAt?.seconds || 0) - (b.appliedAt?.seconds || 0)); // älteste zuerst
    }, [applications, filterState]);

    // "Mark for Showcase" → Warteliste (wie im CreationManager)
    const handleConfirmShowcase = async (note) => {
        if (!showcaseModal) return;
        const { creationId } = showcaseModal;
        const linkRef = doc(db, 'communitys', community.id, 'creations', creationId);
        try {
            await setDoc(linkRef, { markedForShowcase: true, showcaseNote: note }, { merge: true });
            setCreations(prev => prev.map(c => c.id === creationId ? { ...c, markedForShowcase: true, showcaseNote: note } : c));
            setModalMessage('Application accepted — creation is now on the waitlist.');
        } catch (error) {
            setModalMessage(`Error marking for showcase: ${error.message}`);
        } finally {
            setShowcaseModal(null);
        }
    };

    // Direkt in eine Showcase-Gruppe aufnehmen
    const handleAssignGroup = async (creationId, groupId) => {
        const linkRef = doc(db, 'communitys', community.id, 'creations', creationId);
        try {
            await setDoc(linkRef, { markedForShowcase: true, showcaseGroupId: groupId }, { merge: true });
            setCreations(prev => prev.map(c => c.id === creationId ? { ...c, markedForShowcase: true, showcaseGroupId: groupId } : c));
            setModalMessage('Application accepted — creation was added to the showcase group.');
        } catch (error) {
            setModalMessage(`Error assigning group: ${error.message}`);
        } finally {
            setGroupMenu(null);
        }
    };

    return (
        <div>
            {showcaseModal && (
                <ShowcaseNoteModal
                    onConfirm={handleConfirmShowcase}
                    onCancel={() => setShowcaseModal(null)}
                    blacklist={blacklist}
                />
            )}

            <p className="text-center text-gray-500 mb-6">Creators applied to get these creations showcased. Each creation can only apply once.</p>

            {filteredApplications.length === 0 ? (
                <p className="text-center text-gray-500 mt-10 py-10 bg-gray-50 rounded-lg border max-w-3xl mx-auto">
                    {applications.length === 0 ? 'No open showcase applications.' : 'No applications match your filters.'}
                </p>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {filteredApplications.map(creation => (
                        <CreationShowcaseCard
                            key={creation.id}
                            creation={creation}
                            community={community}
                            setPopoverView={setPopoverView}
                            setModalMessage={setModalMessage}
                        >
                            {(creation.tags || []).length > 0 && (
                                <div className="flex flex-wrap gap-1 mt-3">
                                    {creation.tags.map(tag => (
                                        <span key={tag} className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">{tag}</span>
                                    ))}
                                </div>
                            )}
                            <div className="flex gap-2 mt-3 pt-3 border-t">
                                <button
                                    onClick={() => setShowcaseModal({ creationId: creation.id })}
                                    className="flex-1 text-sm font-semibold py-2 px-3 rounded-lg text-white bg-[--theme-color] hover:brightness-90"
                                    title="Accept and add to the showcase waitlist"
                                >
                                    Mark for Showcase
                                </button>
                                <button
                                    onClick={(e) => setGroupMenu({ creationId: creation.id, x: e.clientX, y: e.clientY })}
                                    disabled={(community.showcaseGroups || []).length === 0}
                                    className="flex-1 text-sm font-semibold py-2 px-3 rounded-lg bg-green-500 text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
                                    title={(community.showcaseGroups || []).length === 0 ? 'Create a showcase group first (Groups tab)' : 'Accept and add directly to a showcase group'}
                                >
                                    Add to Group
                                </button>
                            </div>
                        </CreationShowcaseCard>
                    ))}
                </div>
            )}

            {groupMenu && (
                <div ref={groupMenuRef} className="fixed z-30 w-48 bg-white rounded-md shadow-lg border" style={{ top: groupMenu.y, left: Math.min(groupMenu.x, window.innerWidth - 200) }}>
                    {(community.showcaseGroups || []).map(group => (
                        <button key={group.id} onClick={() => handleAssignGroup(groupMenu.creationId, group.id)} className="w-full text-left block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                            {group.name}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};

export default ApplicationsManager;
