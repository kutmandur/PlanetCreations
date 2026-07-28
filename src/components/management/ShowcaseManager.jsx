import React, { useMemo, useState, useEffect, useRef } from 'react';
import { db } from '../../firebase/config';
import { doc, updateDoc, arrayUnion, arrayRemove, writeBatch, query, collection, where, getDocs } from 'firebase/firestore';
import Icon from '../ui/Icon';
import { ICONS, getGameColor, getYoutubeThumbnailUrl, SOCIAL_PLATFORMS } from '../../utils/helpers';
import { getEnabledGameIds } from '../../utils/gamesRegistry';
import useGames from '../../hooks/useGames';
import Spinner from '../ui/Spinner';
import SharingQrCode from '../ui/SharingQrCode';
import CreationCard from '../cards/CreationCard';
import ApplicationsManager from './ApplicationsManager';
import CommunityFilterBar, { creationMatchesFilters } from './CommunityFilterBar';

const SUB_TABS = ['Applications', 'Waitlist', 'Groups', 'Showcased'];
const PUBLIC_ORIGIN = 'https://planetcreations.net';


// Seiteninternes Modal zum Fertigstellen/Bearbeiten eines Showcases
// (ersetzt die früheren Browser-prompt()-Dialoge): Name + Video-URL.
const ShowcaseVideoModal = ({ title, initialName, initialUrl, isSaving, onSave, onClose }) => {
    const [name, setName] = useState(initialName || '');
    const [url, setUrl] = useState(initialUrl || '');
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-xl font-bold text-gray-800 mb-4">{title}</h2>
                <label className="block text-sm font-bold text-gray-700 mb-1">Showcase Name</label>
                <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={80}
                    placeholder="e.g. Summer Showcase #3"
                    className="w-full p-3 border rounded-lg mb-4 focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': 'var(--theme-color)' }}
                />
                <label className="block text-sm font-bold text-gray-700 mb-1">YouTube Video URL</label>
                <input
                    type="url"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2"
                    style={{ '--tw-ring-color': 'var(--theme-color)' }}
                    autoFocus
                    onKeyDown={(e) => { if (e.key === 'Enter' && url.trim()) onSave(name.trim(), url.trim()); }}
                />
                <div className="flex justify-end gap-2 mt-6">
                    <button onClick={onClose} className="py-2 px-4 rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 font-semibold">
                        Cancel
                    </button>
                    <button
                        onClick={() => onSave(name.trim(), url.trim())}
                        disabled={isSaving || !url.trim()}
                        className="py-2 px-6 rounded-lg community-bg hover:brightness-90 text-white font-semibold disabled:opacity-50"
                    >
                        {isSaving ? <Spinner size="small" /> : 'Save'}
                    </button>
                </div>
            </div>
        </div>
    );
};

const ShowcaseManager = ({ creations: allCreations, setCreations, community, setCommunity, setModalMessage, setPopoverView, setConfirmation, blacklist }) => {
    const [activeSubTab, setActiveSubTab] = useState('Applications');
    const [qrModal, setQrModal] = useState(null); // { showcaseId, name }
    const [previewModal, setPreviewModal] = useState(null); // { showcaseId, name }
    const subTabRefs = useRef([]);
    const subGliderRef = useRef(null);

    // Game-Selector: nur die in der Community aktivierten Spiele,
    // Selector wird nur bei mehr als einem Spiel angezeigt
    const allGames = useGames();
    const communityGames = useMemo(() => {
        const allowed = community.allowedGames || allGames.map(g => g.id);
        return allGames.filter(g => allowed.includes(g.id));
    }, [community.allowedGames, allGames]);

    const [activeGame, setActiveGame] = useState(() => {
        const allowed = community.allowedGames || getEnabledGameIds();
        return (community.mainGame && allowed.includes(community.mainGame)) ? community.mainGame : allowed[0];
    });

    // Alle Untertabs arbeiten auf den Creations des aktiven Spiels
    const creations = useMemo(() =>
        communityGames.length > 1 ? allCreations.filter(c => c.game === activeGame) : allCreations,
        [allCreations, communityGames.length, activeGame]);

    const [newGroupName, setNewGroupName] = useState('');
    const [isSavingGroup, setIsSavingGroup] = useState(false);
    // { mode: 'finalize', group: <showcaseGroup> } oder { mode: 'edit', group: <{url, name, creations}> }
    const [videoModal, setVideoModal] = useState(null);
    const [isSavingVideo, setIsSavingVideo] = useState(false);
    const [groupMenu, setGroupMenu] = useState(null);        // Waitlist: Kreation -> Gruppe zuordnen
    // Waitlist-Popover: { kind: 'group', groupId } (Gruppe befüllen)
    // oder { kind: 'showcased', url } (nachträglich zu einem Gruppen-Showcase hinzufügen)
    const [addToGroupMenu, setAddToGroupMenu] = useState(null);
    const groupMenuRef = useRef(null);
    const addToGroupMenuRef = useRef(null);

    // Gemeinsamer Such-/Filterzustand für alle Untertabs
    const [filterState, setFilterState] = useState({ searchTerm: '', status: 'all', rank: 'all', tag: '', dlc: 'all' });
    const handleFilterChange = (field, value) => setFilterState(prev => ({ ...prev, [field]: value }));

    const availableDlcs = useMemo(() => {
        const dlcs = new Set();
        creations.forEach(c => (c.requiredDlcs || []).forEach(dlc => dlcs.add(dlc)));
        return [...dlcs].sort();
    }, [creations]);

    const passesFilters = (creation) => {
        if (filterState.status !== 'all' && creation.status !== filterState.status) return false;
        return creationMatchesFilters(creation, filterState);
    };

    const isAnyFilterActive =
        filterState.searchTerm.trim() !== '' ||
        filterState.status !== 'all' ||
        filterState.rank !== 'all' ||
        filterState.dlc !== 'all' ||
        filterState.tag.trim() !== '';

    // Gültige Gruppen-IDs der Community. Eine Kreation, deren showcaseGroupId auf
    // eine nicht (mehr) existierende Gruppe zeigt (z. B. nach dem Finalisieren oder
    // Entfernen eines Showcases), gilt als "keiner Gruppe zugeordnet" und landet
    // wieder auf der Waitlist, statt unsichtbar zu verschwinden.
    const validGroupIds = useMemo(
        () => new Set((community.showcaseGroups || []).map(g => g.id)),
        [community.showcaseGroups]);

    const inLiveGroup = (c) => c.showcaseGroupId && validGroupIds.has(c.showcaseGroupId);

    const { waitlist, alreadyShowcased } = useMemo(() => {
        const marked = creations.filter(c => c.markedForShowcase && !c.showcaseVideoUrl && !inLiveGroup(c));
        const showcased = creations.filter(c => !!c.showcaseVideoUrl);
        return { waitlist: marked, alreadyShowcased: showcased };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [creations, validGroupIds]);

    const openApplicationsCount = useMemo(() =>
        creations.filter(c => c.appliedForShowcase && !c.markedForShowcase && !c.showcaseVideoUrl && !inLiveGroup(c)).length,
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [creations, validGroupIds]);

    // Showcased: Creations mit derselben Video-URL wurden zusammen (als Gruppe)
    // geshowcased und werden in einer gemeinsamen Karte angezeigt.
    const { showcasedSingles, showcasedGroups } = useMemo(() => {
        const byUrl = new Map();
        alreadyShowcased.forEach(c => {
            if (!byUrl.has(c.showcaseVideoUrl)) byUrl.set(c.showcaseVideoUrl, []);
            byUrl.get(c.showcaseVideoUrl).push(c);
        });
        const singles = [];
        const groups = [];
        byUrl.forEach((list, url) => {
            const name = list.find(c => c.showcaseName)?.showcaseName || null;
            const showcaseId = list.find(c => c.showcaseGroupId)?.showcaseGroupId || null;
            if (list.length === 1) singles.push(list[0]);
            else groups.push({ url, name, showcaseId, creations: list });
        });
        return { showcasedSingles: singles, showcasedGroups: groups };
    }, [alreadyShowcased]);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (groupMenuRef.current && !groupMenuRef.current.contains(event.target)) setGroupMenu(null);
            if (addToGroupMenuRef.current && !addToGroupMenuRef.current.contains(event.target)) setAddToGroupMenu(null);
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        const activeIndex = SUB_TABS.findIndex(tab => tab === activeSubTab);
        const activeNode = subTabRefs.current[activeIndex];
        if (activeNode && subGliderRef.current) {
            subGliderRef.current.style.left = `${activeNode.offsetLeft}px`;
            subGliderRef.current.style.width = `${activeNode.offsetWidth}px`;
        }
    }, [activeSubTab]);

    const handleCreateGroup = async () => {
        const trimmedName = newGroupName.trim();
        if (!trimmedName) return;
        const alreadyExists = (community.showcaseGroups || []).some(g => g.name.toLowerCase() === trimmedName.toLowerCase());
        if (alreadyExists) {
            setModalMessage('A group with this name already exists.');
            return;
        }
        setIsSavingGroup(true);
        const newGroup = { id: `group_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`, name: trimmedName };
        const communityRef = doc(db, 'communitys', community.id);
        try {
            await updateDoc(communityRef, { showcaseGroups: arrayUnion(newGroup) });
            setNewGroupName('');
        } catch (error) {
            setModalMessage(`Error creating group: ${error.message}`);
        } finally {
            setIsSavingGroup(false);
        }
    };

    const handleDeleteGroup = async (groupToDelete) => {
        setConfirmation({
            message: `Are you sure you want to delete the group "${groupToDelete.name}"? This will unassign it from all creations.`,
            onConfirm: async () => {
                setIsSavingGroup(true);
                const communityRef = doc(db, 'communitys', community.id);
                try {
                    const batch = writeBatch(db);
                    batch.update(communityRef, { showcaseGroups: arrayRemove(groupToDelete) });
                    const q = query(collection(db, 'communitys', community.id, 'creations'), where('showcaseGroupId', '==', groupToDelete.id));
                    const snapshot = await getDocs(q);
                    snapshot.forEach(doc => batch.update(doc.ref, { showcaseGroupId: null }));
                    await batch.commit();
                    setCreations(prev => prev.map(c => c.showcaseGroupId === groupToDelete.id ? { ...c, showcaseGroupId: null } : c));
                    setModalMessage("Group deleted and unassigned from creations.");
                } catch (error) {
                    setModalMessage(`Error deleting group: ${error.message}`);
                } finally {
                    setIsSavingGroup(false);
                }
            }
        });
    };

    const handleAssignGroup = async (creationId, groupId) => {
        const linkRef = doc(db, 'communitys', community.id, 'creations', creationId);
        try {
            await updateDoc(linkRef, { showcaseGroupId: groupId || null });
            setCreations(prev => prev.map(c => c.id === creationId ? { ...c, showcaseGroupId: groupId || null } : c));
        } catch (error) {
            setModalMessage(`Error assigning group: ${error.message}`);
        } finally {
            setGroupMenu(null);
        }
    };

    const handleRemoveFromGroup = async (creationId) => {
        const linkRef = doc(db, 'communitys', community.id, 'creations', creationId);
        try {
            await updateDoc(linkRef, { showcaseGroupId: null });
            setCreations(prev => prev.map(c => c.id === creationId ? { ...c, showcaseGroupId: null } : c));
        } catch (error) {
            setModalMessage(`Error removing from group: ${error.message}`);
        }
    };

    // Gruppe fertigstellen: Modal öffnen (Name ist mit dem Gruppennamen vorbelegt)
    const handleAddVideoToGroup = (group) => {
        const creationsInThisGroup = creations.filter(c => c.showcaseGroupId === group.id);
        if (creationsInThisGroup.length === 0) {
            setModalMessage("No creations found in this group to update.");
            return;
        }
        setVideoModal({ mode: 'finalize', group });
    };

    const finalizeGroupShowcase = async (group, showcaseName, videoUrl) => {
        setIsSavingVideo(true);
        try {
            const batch = writeBatch(db);
            const creationsToUpdate = creations.filter(c => c.showcaseGroupId === group.id);
            creationsToUpdate.forEach(c => {
                const linkRef = doc(db, 'communitys', community.id, 'creations', c.id);
                batch.update(linkRef, { showcaseVideoUrl: videoUrl, showcaseName: showcaseName || null });
            });

            const communityRef = doc(db, 'communitys', community.id);
            batch.update(communityRef, { showcaseGroups: arrayRemove(group) });

            await batch.commit();

            setCreations(prev => prev.map(c => c.showcaseGroupId === group.id ? { ...c, showcaseVideoUrl: videoUrl, showcaseName: showcaseName || null } : c));
            setCommunity(prevCommunity => ({
                ...prevCommunity,
                showcaseGroups: (prevCommunity.showcaseGroups || []).filter(g => g.id !== group.id)
            }));

            setVideoModal(null);
            setModalMessage(`Showcase video added to ${creationsToUpdate.length} creation(s) and the group has been cleared.`);
        } catch (error) {
            setModalMessage(`Error adding video to group: ${error.message}`);
        } finally {
            setIsSavingVideo(false);
        }
    };

    // Einzelne Kreation (ohne Gruppe) direkt fertigstellen: Modal öffnen.
    const handleFinalizeSingle = (creation) => {
        setVideoModal({ mode: 'single', creation });
    };

    const finalizeSingleShowcase = async (creation, showcaseName, videoUrl) => {
        setIsSavingVideo(true);
        const linkRef = doc(db, 'communitys', community.id, 'creations', creation.id);
        try {
            await updateDoc(linkRef, { showcaseVideoUrl: videoUrl, showcaseName: showcaseName || null });
            setCreations(prev => prev.map(c => c.id === creation.id ? { ...c, showcaseVideoUrl: videoUrl, showcaseName: showcaseName || null } : c));
            setVideoModal(null);
            setModalMessage('Creation showcased. Its QR code links directly to the creation.');
        } catch (error) {
            setModalMessage(`Error showcasing creation: ${error.message}`);
        } finally {
            setIsSavingVideo(false);
        }
    };

    const handleRemoveFromShowcase = async (creationId) => {
        const linkRef = doc(db, 'communitys', community.id, 'creations', creationId);
        try {
            // appliedForShowcase ebenfalls zurücksetzen, sonst taucht die Kreation
            // sofort wieder unter "Applications" auf (= keine echte Ablehnung möglich).
            await updateDoc(linkRef, {
                markedForShowcase: false,
                appliedForShowcase: false,
                showcaseNote: '',
                showcaseGroupId: null
            });
            setCreations(prev => prev.map(c => c.id === creationId ? { ...c, markedForShowcase: false, appliedForShowcase: false, showcaseNote: '', showcaseGroupId: null } : c));
            setModalMessage("Creation removed from the waitlist.");
        } catch (error) {
            setModalMessage(`Error removing from waitlist: ${error.message}`);
        }
    };

    const handleRemoveShowcaseVideo = async (creationId) => {
        const linkRef = doc(db, 'communitys', community.id, 'creations', creationId);
        try {
            // showcaseGroupId ebenfalls leeren: sonst bleibt die Kreation mit einer
            // verwaisten Gruppen-ID zurück und taucht weder auf der Waitlist noch
            // in einer Gruppe wieder auf.
            await updateDoc(linkRef, { showcaseVideoUrl: null, showcaseName: null, showcaseGroupId: null });
            setCreations(prev => prev.map(c => c.id === creationId ? { ...c, showcaseVideoUrl: null, showcaseName: null, showcaseGroupId: null } : c));
            setModalMessage("Showcase video removed successfully.");
        } catch (error) {
            setModalMessage(`Error removing showcase video: ${error.message}`);
        }
    };

    const creationsInGroup = (groupId) => creations.filter(c => c.showcaseGroupId === groupId);

    const getThumbnail = (creation) => {
        if (creation.imageUrls?.length > 0) return creation.imageUrls[0];
        const videoThumb = getYoutubeThumbnailUrl(creation.videoUrls?.[0]);
        return videoThumb || 'https://placehold.co/400x225/333333/ffffff?text=No+Media';
    };

    const getTextColorForBackground = (hexColor) => {
        if (!hexColor) return '#ffffff';
        const r = parseInt(hexColor.substr(1, 2), 16);
        const g = parseInt(hexColor.substr(3, 2), 16);
        const b = parseInt(hexColor.substr(5, 2), 16);
        const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
        return (yiq >= 128) ? '#000000' : '#ffffff';
    };

    // Name/Video-URL eines bestehenden Gruppen-Showcases nachträglich ändern (Modal)
    const handleEditGroupShowcaseUrl = (group) => {
        setVideoModal({ mode: 'edit', group });
    };

    const updateGroupShowcase = async (group, showcaseName, videoUrl) => {
        setIsSavingVideo(true);
        try {
            const batch = writeBatch(db);
            group.creations.forEach(c => {
                batch.update(doc(db, 'communitys', community.id, 'creations', c.id), { showcaseVideoUrl: videoUrl, showcaseName: showcaseName || null });
            });
            await batch.commit();
            const ids = group.creations.map(c => c.id);
            setCreations(prev => prev.map(c => ids.includes(c.id) ? { ...c, showcaseVideoUrl: videoUrl, showcaseName: showcaseName || null } : c));
            setVideoModal(null);
            setModalMessage(`Showcase updated for ${group.creations.length} creation(s).`);
        } catch (error) {
            setModalMessage(`Error updating showcase: ${error.message}`);
        } finally {
            setIsSavingVideo(false);
        }
    };

    // Kreation von der Waitlist nachträglich zu einem Gruppen-Showcase hinzufügen
    // (übernimmt den Showcase-Namen der bestehenden Gruppe)
    const handleAddToShowcasedGroup = async (creationId, videoUrl) => {
        const linkRef = doc(db, 'communitys', community.id, 'creations', creationId);
        const existingName = creations.find(c => c.showcaseVideoUrl === videoUrl && c.showcaseName)?.showcaseName || null;
        try {
            await updateDoc(linkRef, { showcaseVideoUrl: videoUrl, showcaseName: existingName });
            setCreations(prev => prev.map(c => c.id === creationId ? { ...c, showcaseVideoUrl: videoUrl, showcaseName: existingName } : c));
            setModalMessage('Creation added to the group showcase.');
        } catch (error) {
            setModalMessage(`Error adding to group showcase: ${error.message}`);
        }
    };

    // Showcase-Video einer ganzen Gruppe entfernen (mit Bestätigung)
    const handleRemoveGroupShowcase = (group) => {
        setConfirmation({
            message: `Are you sure you want to remove this group showcase? The video will be removed from all ${group.creations.length} creations.`,
            onConfirm: async () => {
                try {
                    const batch = writeBatch(db);
                    group.creations.forEach(c => {
                        batch.update(doc(db, 'communitys', community.id, 'creations', c.id), { showcaseVideoUrl: null, showcaseName: null, showcaseGroupId: null });
                    });
                    await batch.commit();
                    const ids = group.creations.map(c => c.id);
                    setCreations(prev => prev.map(c => ids.includes(c.id) ? { ...c, showcaseVideoUrl: null, showcaseName: null, showcaseGroupId: null } : c));
                    setModalMessage(`Group showcase removed from ${group.creations.length} creation(s).`);
                } catch (error) {
                    setModalMessage(`Error removing group showcase: ${error.message}`);
                }
            }
        });
    };

    const renderWaitlist = () => {
        const filteredWaitlist = waitlist.filter(passesFilters);
        if (waitlist.length > 0 && filteredWaitlist.length === 0) {
            return <p className="text-center text-gray-500 py-10 bg-gray-50 rounded-lg border max-w-3xl mx-auto">No waitlist creations match your filters.</p>;
        }
        return filteredWaitlist.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {filteredWaitlist.map(creation => {
                    const customData = creation.communitySpecificData?.[community.id] || {};
                    return (
                        <div key={creation.id} className="bg-white rounded-lg shadow-lg overflow-hidden flex flex-col h-full group">
                            <button onClick={() => setPopoverView({ name: 'detail', id: creation.id })} className="w-full text-left focus:outline-none">
                                <div className="relative overflow-hidden h-40">
                                    <img
                                        src={getThumbnail(creation)}
                                        alt={creation.title}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                        onError={(e) => { e.target.onerror = null; e.target.src = 'https://placehold.co/400x225/333333/ffffff?text=Image+Missing'; }}
                                    />
                                    <span className={`absolute top-2 right-2 text-xs font-semibold px-2 py-0.5 rounded-full ${creation.status === 'finished' ? 'bg-green-500 text-white' : 'bg-orange-400 text-white'}`}>
                                        {creation.status === 'finished' ? 'Finished' : 'WIP'}
                                    </span>
                                </div>
                                <div className="p-3">
                                    <h3 className="text-lg font-bold truncate" title={creation.title}>{creation.title}</h3>
                                    <p className="text-sm text-gray-500">by {creation.username}</p>
                                    <div className="flex flex-wrap gap-1 mt-2">
                                        {(creation.creatorRanks || []).map(rank => (
                                            <span key={rank.name} className="text-xs font-semibold px-2 py-0.5 rounded-full capitalize" style={{ backgroundColor: rank.color || '#6B7280', color: getTextColorForBackground(rank.color || '#6B7280') }}>
                                                {rank.name}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            </button>
                            <div className="px-3 pb-2 flex-grow">
                                {creation.showcaseNote && (
                                    <p className="text-xs text-gray-500 italic bg-gray-50 rounded p-2" title={creation.showcaseNote}>
                                        “{creation.showcaseNote}”
                                    </p>
                                )}
                                {creation.shareCode && (
                                    <button
                                        onClick={() => { navigator.clipboard.writeText(creation.shareCode); setModalMessage('Share Code copied to clipboard!'); }}
                                        className="w-full flex items-center justify-between text-left p-2 mt-2 bg-gray-100 rounded hover:bg-gray-200 transition-colors"
                                    >
                                        <span className="text-xs font-mono text-gray-700 truncate">{creation.shareCode}</span>
                                        <Icon path={ICONS.copy} className="w-4 h-4 text-gray-500 flex-shrink-0" />
                                    </button>
                                )}
                                {community.customCreationFields?.map(field => {
                                    const value = customData[field.id];
                                    if (!value) return null;
                                    return (
                                        <div key={field.id} className="mt-1 p-2 bg-gray-100 rounded">
                                            <p className="text-xs font-bold text-gray-500">{field.label}</p>
                                            <p className="text-sm text-gray-800 truncate">{String(value)}</p>
                                        </div>
                                    );
                                })}
                            </div>
                            <div className="p-3 border-t mt-auto flex gap-2">
                                <button
                                    onClick={(e) => setGroupMenu({ creationId: creation.id, x: e.clientX, y: e.clientY })}
                                    className="flex-1 text-sm font-semibold py-2 px-3 rounded-lg text-white community-bg hover:brightness-90"
                                    title="Assign to Group"
                                >
                                    Add to Group
                                </button>
                                <button
                                    onClick={() => handleFinalizeSingle(creation)}
                                    className="flex items-center gap-1 text-sm font-semibold py-2 px-3 rounded-lg text-white bg-green-500 hover:bg-green-600"
                                    title="Finalize this creation on its own (QR links directly to the creation)"
                                >
                                    <Icon path={ICONS.video} className="w-4 h-4" /> Finalize
                                </button>
                                <button
                                    onClick={() => handleRemoveFromShowcase(creation.id)}
                                    className="p-2 rounded-lg bg-gray-100 text-gray-500 hover:bg-red-100 hover:text-red-600"
                                    title="Remove from Waitlist"
                                >
                                    <Icon path={ICONS.trash} className="w-5 h-5" />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        ) : (
            <p className="text-center text-gray-500 py-10 bg-gray-50 rounded-lg border max-w-3xl mx-auto">Creations on the showcase waitlist will appear here.</p>
        );
    };

    const renderGroups = () => {
        const searchLower = filterState.searchTerm.trim().toLowerCase();
        // Gruppe sichtbar wenn: kein Filter aktiv, Gruppenname matcht, oder
        // mindestens eine enthaltene Kreation die Filter besteht
        const visibleGroups = (community.showcaseGroups || []).map(group => {
            const all = creationsInGroup(group.id);
            const nameMatch = searchLower && group.name.toLowerCase().includes(searchLower);
            const matching = all.filter(passesFilters);
            return {
                group,
                creations: (!isAnyFilterActive || nameMatch) ? all : matching,
                visible: !isAnyFilterActive || nameMatch || matching.length > 0,
            };
        }).filter(g => g.visible);

        return (
        <div className="max-w-3xl mx-auto">
            <div className="flex gap-2 max-w-sm mx-auto mb-6">
                <input type="text" value={newGroupName} onChange={(e) => setNewGroupName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleCreateGroup(); }} placeholder="New group name..." className="flex-grow p-2 border rounded-lg" />
                <button onClick={handleCreateGroup} disabled={isSavingGroup || !newGroupName.trim()} className="bg-green-500 hover:bg-green-600 text-white font-bold p-2 px-4 rounded-lg disabled:opacity-50">
                    {isSavingGroup ? <Spinner size="small" /> : 'Add Group'}
                </button>
            </div>
            <div className="space-y-4">
                {(community.showcaseGroups || []).length === 0 && (
                    <p className="text-center text-gray-500 py-10 bg-gray-50 rounded-lg border">No showcase groups yet. Create one above.</p>
                )}
                {(community.showcaseGroups || []).length > 0 && visibleGroups.length === 0 && (
                    <p className="text-center text-gray-500 py-10 bg-gray-50 rounded-lg border">No groups match your filters.</p>
                )}
                {visibleGroups.map(({ group, creations: groupCreations }) => {
                    return (
                        <div key={group.id} className="p-4 bg-white rounded-lg shadow border">
                            <div className="flex items-center justify-between">
                                <h4 className="font-bold text-xl text-gray-800 truncate pr-2">{group.name}</h4>
                                <div className="flex items-center space-x-1 flex-shrink-0">
                                    <button onClick={(e) => setAddToGroupMenu({ kind: 'group', groupId: group.id, x: e.clientX, y: e.clientY })} className="p-2 text-gray-500 hover:text-blue-600" title="Add creation from waitlist">
                                        <Icon path={ICONS.plus} className="w-5 h-5" />
                                    </button>
                                    <button onClick={() => handleAddVideoToGroup(group)} className="p-2 text-gray-500 hover:text-green-600" title="Add Video to Group (showcases all creations)">
                                        <Icon path={ICONS.video} className="w-5 h-5" />
                                    </button>
                                    <button onClick={() => setQrModal({ url: `${PUBLIC_ORIGIN}/#/showcase/${group.id}`, name: group.name, showcaseId: group.id })} className="p-2 text-gray-500 hover:text-blue-600" title="Show sharing QR code">
                                        <Icon path={ICONS.share} className="w-5 h-5" />
                                    </button>
                                    <button onClick={() => handleDeleteGroup(group)} className="p-2 text-gray-500 hover:text-red-600" title="Delete Group">
                                        <Icon path={ICONS.trash} className="w-5 h-5" />
                                    </button>
                                </div>
                            </div>
                            <div className="mt-3 pt-3 border-t space-y-2">
                                {groupCreations.length === 0 ? (
                                    <p className="text-sm text-gray-400 text-center py-2">Empty group — add creations via the + button.</p>
                                ) : groupCreations.map(creation => (
                                    <div key={creation.id} className="flex items-center justify-between p-2 bg-gray-50 rounded border">
                                        <button onClick={() => setPopoverView({ name: 'detail', id: creation.id })} className="text-sm font-semibold text-blue-600 hover:underline truncate text-left pr-2" title={creation.title}>
                                            {creation.title}
                                        </button>
                                        <button onClick={() => handleRemoveFromGroup(creation.id)} className="p-1 text-gray-400 hover:text-red-600 flex-shrink-0" title="Remove from group (back to waitlist)">
                                            <span className="text-lg font-bold leading-none">×</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
        );
    };

    const renderShowcased = () => {
        const filteredSingles = showcasedSingles.filter(passesFilters);
        // Gruppen-Showcase sichtbar, wenn mindestens eine Kreation die Filter besteht;
        // ohne aktive Filter alle Kreationen zeigen
        const filteredGroups = showcasedGroups.map(group => ({
            ...group,
            visibleCreations: isAnyFilterActive ? group.creations.filter(passesFilters) : group.creations,
        })).filter(group => group.visibleCreations.length > 0);

        return (
        <div className="max-w-3xl mx-auto space-y-3">
            {alreadyShowcased.length === 0 && (
                <p className="text-center text-gray-500 py-10 bg-gray-50 rounded-lg border">Creations with a showcase video will appear here.</p>
            )}
            {alreadyShowcased.length > 0 && filteredGroups.length === 0 && filteredSingles.length === 0 && (
                <p className="text-center text-gray-500 py-10 bg-gray-50 rounded-lg border">No showcased creations match your filters.</p>
            )}
            {filteredGroups.map(group => (
                <div key={group.url} className="p-4 bg-white rounded-lg shadow border">
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="font-bold text-gray-800 truncate pr-2" title={group.name || 'Group Showcase'}>
                            {group.name || 'Group Showcase'} <span className="font-normal text-gray-500">({group.creations.length} creations)</span>
                        </h4>
                        <div className="flex items-center gap-1 flex-shrink-0">
                            <a href={group.url} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-blue-600 hover:underline mr-2">
                                Watch video ↗
                            </a>
                            <button onClick={(e) => setAddToGroupMenu({ kind: 'showcased', url: group.url, x: e.clientX, y: e.clientY })} className="p-2 text-gray-500 hover:text-blue-600" title="Add creation from waitlist to this showcase">
                                <Icon path={ICONS.plus} className="w-5 h-5" />
                            </button>
                            <button onClick={() => handleEditGroupShowcaseUrl(group)} className="p-2 text-gray-500 hover:text-green-600" title="Edit video URL">
                                <Icon path={ICONS.edit} className="w-5 h-5" />
                            </button>
                            {group.showcaseId && (
                                <button onClick={() => setQrModal({ url: `${PUBLIC_ORIGIN}/#/showcase/${group.showcaseId}`, name: group.name, showcaseId: group.showcaseId })} className="p-2 text-gray-500 hover:text-blue-600" title="Show sharing QR code">
                                    <Icon path={ICONS.share} className="w-5 h-5" />
                                </button>
                            )}
                            <button onClick={() => handleRemoveGroupShowcase(group)} className="p-2 text-gray-500 hover:text-red-600" title="Remove showcase from the whole group">
                                <Icon path={ICONS.trash} className="w-5 h-5" />
                            </button>
                        </div>
                    </div>
                    <div className="space-y-2 pt-2 border-t">
                        {group.visibleCreations.map(creation => (
                            <div key={creation.id} className="flex items-center justify-between p-2 bg-gray-50 rounded border">
                                <button onClick={() => setPopoverView({ name: 'detail', id: creation.id })} className="text-sm font-semibold text-blue-600 hover:underline truncate text-left pr-2" title={creation.title}>
                                    {creation.title}
                                </button>
                                <button onClick={() => handleRemoveShowcaseVideo(creation.id)} className="p-1 text-gray-400 hover:text-red-600 flex-shrink-0" title="Remove Showcase Video">
                                    <Icon path={ICONS.xCircle} className="w-5 h-5" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
            {filteredSingles.map(creation => (
                <div key={creation.id} className="flex items-center justify-between p-3 bg-white rounded-lg shadow border">
                    <button onClick={() => setPopoverView({ name: 'detail', id: creation.id })} className="font-semibold text-blue-600 hover:underline truncate text-left w-full pr-2" title={creation.showcaseName || creation.title}>
                        {creation.showcaseName || creation.title}
                    </button>
                    <div className="flex items-center gap-1 flex-shrink-0">
                        {creation.showcaseVideoUrl && (
                            <a href={creation.showcaseVideoUrl} target="_blank" rel="noopener noreferrer" className="text-sm font-semibold text-blue-600 hover:underline mr-1 whitespace-nowrap">
                                Watch video ↗
                            </a>
                        )}
                        <button onClick={() => setQrModal({ url: `${PUBLIC_ORIGIN}/#/creation/${creation.id}`, name: creation.showcaseName || creation.title, showcaseId: null })} className="p-2 text-gray-500 hover:text-blue-600" title="Show sharing QR code (links directly to the creation)">
                            <Icon path={ICONS.share} className="w-5 h-5" />
                        </button>
                        <button onClick={() => handleRemoveShowcaseVideo(creation.id)} className="p-2 text-gray-500 hover:text-red-600" title="Remove Showcase Video">
                            <Icon path={ICONS.xCircle} className="w-5 h-5" />
                        </button>
                    </div>
                </div>
            ))}
        </div>
        );
    };

    return (
        <div>
            {communityGames.length > 1 && (
                <div className="flex justify-center mb-4">
                    <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner overflow-x-auto">
                        {communityGames.map(game => {
                            const gameColor = getGameColor(game.id);
                            return (
                                <button
                                    key={game.id}
                                    onClick={() => setActiveGame(game.id)}
                                    style={gameColor.style}
                                    className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 text-sm font-medium ${activeGame === game.id ? `${gameColor.bg} text-white` : 'text-gray-600 hover:text-black'}`}
                                >
                                    {game.name}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            <div className="flex justify-center mb-8">
                <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner overflow-x-auto">
                    <div ref={subGliderRef} className="absolute h-full community-bg rounded-full transition-all duration-300 ease-in-out" />
                    {SUB_TABS.map((tab, index) => (
                        <button
                            key={tab}
                            ref={el => subTabRefs.current[index] = el}
                            onClick={() => setActiveSubTab(tab)}
                            className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 text-sm sm:text-base font-medium whitespace-nowrap ${activeSubTab === tab ? 'text-white' : 'text-gray-600 hover:text-black'}`}
                        >
                            {tab}
                            {tab === 'Applications' && openApplicationsCount > 0 && (
                                <span className={`ml-1.5 text-xs font-bold px-1.5 py-0.5 rounded-full ${activeSubTab === tab ? 'bg-white text-gray-800' : 'community-bg text-white'}`}>
                                    {openApplicationsCount}
                                </span>
                            )}
                        </button>
                    ))}
                </div>
            </div>

            <CommunityFilterBar
                searchTerm={filterState.searchTerm}
                onSearchChange={(value) => handleFilterChange('searchTerm', value)}
                filters={filterState}
                onFilterChange={handleFilterChange}
                ranks={community.ranks || []}
                availableDlcs={availableDlcs}
                statusOptions={[
                    { value: 'all', label: 'All Statuses' },
                    { value: 'finished', label: 'Finished' },
                    { value: 'wip', label: 'Work in Progress' },
                ]}
                placeholder={activeSubTab === 'Groups' ? 'Search groups or creations...' : 'Search by title, creator or tag...'}
            />

            {activeSubTab === 'Applications' && (
                <ApplicationsManager
                    creations={creations}
                    setCreations={setCreations}
                    community={community}
                    setModalMessage={setModalMessage}
                    setPopoverView={setPopoverView}
                    blacklist={blacklist}
                    filterState={filterState}
                />
            )}
            {activeSubTab === 'Waitlist' && renderWaitlist()}
            {activeSubTab === 'Groups' && renderGroups()}
            {activeSubTab === 'Showcased' && renderShowcased()}

            {/* Waitlist: Kreation einer Gruppe zuordnen */}
            {groupMenu && (
                <div ref={groupMenuRef} className="fixed z-30 w-48 bg-white rounded-md shadow-lg border" style={{ top: groupMenu.y, left: Math.min(groupMenu.x, window.innerWidth - 200) }}>
                    {(community.showcaseGroups || []).length === 0 && (
                        <p className="px-4 py-2 text-sm text-gray-400">No groups yet.</p>
                    )}
                    {(community.showcaseGroups || []).map(group => (
                        <button key={group.id} onClick={() => handleAssignGroup(groupMenu.creationId, group.id)} className="w-full text-left block px-4 py-2 text-sm text-gray-700 hover:bg-gray-100">
                            {group.name}
                        </button>
                    ))}
                </div>
            )}

            {/* Groups: Popover mit Waitlist zum Hinzufügen in die Gruppe */}
            {addToGroupMenu && (
                <div ref={addToGroupMenuRef} className="fixed z-30 w-72 max-h-80 overflow-y-auto bg-white rounded-md shadow-lg border" style={{ top: addToGroupMenu.y, left: Math.min(addToGroupMenu.x, window.innerWidth - 300) }}>
                    <p className="px-4 py-2 text-xs font-bold text-gray-500 border-b sticky top-0 bg-white">Add from waitlist</p>
                    {waitlist.length === 0 ? (
                        <p className="px-4 py-3 text-sm text-gray-400">The waitlist is empty.</p>
                    ) : (
                        waitlist.map(creation => (
                            <button
                                key={creation.id}
                                onClick={() => {
                                    if (addToGroupMenu.kind === 'showcased') {
                                        handleAddToShowcasedGroup(creation.id, addToGroupMenu.url);
                                    } else {
                                        handleAssignGroup(creation.id, addToGroupMenu.groupId);
                                    }
                                    setAddToGroupMenu(null);
                                }}
                                className="w-full text-left flex items-center justify-between px-4 py-2 text-sm text-gray-700 hover:bg-gray-100"
                            >
                                <span className="truncate pr-2">{creation.title}</span>
                                <Icon path={ICONS.plus} className="w-4 h-4 text-green-600 flex-shrink-0" />
                            </button>
                        ))
                    )}
                </div>
            )}

            {/* Showcase fertigstellen / bearbeiten (Name + Video-URL) */}
            {videoModal && (
                <ShowcaseVideoModal
                    title={
                        videoModal.mode === 'finalize' ? `Showcase "${videoModal.group.name}"`
                        : videoModal.mode === 'single' ? `Showcase "${videoModal.creation.title}"`
                        : 'Edit Showcase'
                    }
                    initialName={
                        videoModal.mode === 'single'
                            ? (videoModal.creation.showcaseName || videoModal.creation.title || '')
                            : (videoModal.group.name || '')
                    }
                    initialUrl={
                        videoModal.mode === 'edit' ? videoModal.group.url
                        : videoModal.mode === 'single' ? (videoModal.creation.showcaseVideoUrl || '')
                        : ''
                    }
                    isSaving={isSavingVideo}
                    onSave={(name, url) =>
                        videoModal.mode === 'finalize' ? finalizeGroupShowcase(videoModal.group, name, url)
                        : videoModal.mode === 'single' ? finalizeSingleShowcase(videoModal.creation, name, url)
                        : updateGroupShowcase(videoModal.group, name, url)}
                    onClose={() => { if (!isSavingVideo) setVideoModal(null); }}
                />
            )}

            {/* Showcase sharing QR code + explanation for the video creator */}
            {qrModal && (
                <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={() => setQrModal(null)}>
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
                        <h2 className="text-xl font-bold text-gray-800 mb-1">Sharing QR code</h2>
                        <p className="text-sm text-gray-500 mb-4">
                            {qrModal.showcaseId
                                ? 'Add this QR code to your showcase video. When viewers scan it, it opens all the creations in this showcase at once on PlanetCreations.'
                                : 'Add this QR code to your video. When viewers scan it, it opens this creation directly on PlanetCreations.'}
                        </p>
                        <SharingQrCode
                            url={qrModal.url}
                            name={qrModal.name || (qrModal.showcaseId ? 'Showcase' : 'Creation')}
                            fileLabel={qrModal.name || (qrModal.showcaseId ? 'showcase' : 'creation')}
                            heading={null}
                            previewClassName="max-w-[240px]"
                            containerClassName=""
                            copyLabel={qrModal.showcaseId ? 'Copy Showcase Link' : 'Copy Creation Link'}
                        />
                        {qrModal.showcaseId && (
                            <button
                                onClick={() => setPreviewModal({ showcaseId: qrModal.showcaseId, name: qrModal.name })}
                                className="w-full mt-3 py-2 px-4 rounded-lg bg-gray-200 hover:bg-gray-300 text-gray-800 font-semibold"
                            >
                                Preview landing page
                            </button>
                        )}
                        <div className="flex justify-end mt-4">
                            <button onClick={() => setQrModal(null)} className="py-2 px-4 rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 font-semibold">Close</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Landing-page preview: video placeholder + currently assigned creations */}
            {previewModal && (
                <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-start z-50 p-4 overflow-y-auto" onClick={() => setPreviewModal(null)}>
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl my-8 p-6" onClick={(e) => e.stopPropagation()} style={{ '--theme-color': community.themeColor || '#F97316' }}>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold text-gray-800">Landing page preview</h2>
                            <button onClick={() => setPreviewModal(null)} className="p-2 text-gray-400 hover:text-gray-700 rounded-full hover:bg-gray-100" aria-label="Close">
                                <span className="text-2xl font-bold leading-none">×</span>
                            </button>
                        </div>

                        {/* Community banner (as on the public landing page) */}
                        <div className="relative mb-4">
                            <img
                                src={community.bannerImageUrl || 'https://placehold.co/1200x300/e2e8f0/64748b?text=Community+Banner'}
                                alt={`${community.name} Banner`}
                                className="w-full h-32 sm:h-40 object-cover rounded-lg"
                            />
                            {SOCIAL_PLATFORMS.some(p => community.socialLinks?.[p.id]) && (
                                <div className="absolute bottom-2 right-2 flex gap-2">
                                    {SOCIAL_PLATFORMS.filter(p => community.socialLinks?.[p.id]).map(platform => (
                                        <span key={platform.id} title={platform.label} className="w-8 h-8 rounded-full bg-black/60 text-white flex items-center justify-center shadow">
                                            <Icon path={platform.icon} solid={platform.solid} className="w-4 h-4" />
                                        </span>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* Home + View Community buttons directly under the banner (preview only) */}
                        <div className="flex justify-between items-center gap-2 mb-5">
                            <span className="flex items-center community-bg text-white px-3 py-2 rounded-md font-semibold text-sm">
                                <Icon path={ICONS.arrowLeft} className="w-4 h-4 mr-1" /> Homepage
                            </span>
                            <div className="text-center flex-grow min-w-0">
                                <h3 className="text-lg sm:text-2xl font-bold text-gray-800 truncate">{community.name}</h3>
                            </div>
                            <span className="bg-gray-200 text-gray-800 px-3 py-2 rounded-md font-semibold text-sm whitespace-nowrap">View Community</span>
                        </div>

                        {previewModal.name && (
                            <h4 className="text-xl sm:text-2xl font-bold text-center text-gray-800 mb-5">{previewModal.name}</h4>
                        )}
                        {/* Video player placeholder */}
                        <div className="max-w-2xl mx-auto mb-8 aspect-video rounded-lg bg-gray-800 flex flex-col items-center justify-center text-gray-300">
                            <div className="w-16 h-16 rounded-full bg-black/50 flex items-center justify-center mb-2">
                                <div className="w-0 h-0 border-y-8 border-y-transparent border-l-[14px] border-l-white ml-1" />
                            </div>
                            <p className="text-sm">Showcase video player</p>
                        </div>
                        <h4 className="text-lg font-bold mb-3 text-gray-800">Featured Creations</h4>
                        {(() => {
                            const previewCreations = creations.filter(c => c.showcaseGroupId === previewModal.showcaseId);
                            return previewCreations.length === 0 ? (
                                <p className="text-center text-gray-400 py-6">No creations assigned to this showcase yet.</p>
                            ) : (
                                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 md:grid-cols-3">
                                    {previewCreations.map(c => <CreationCard key={c.id} creation={c} isLink={false} />)}
                                </div>
                            );
                        })()}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ShowcaseManager;
