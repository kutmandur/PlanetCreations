import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom'; 
import {
    addDoc, collection, doc, getDoc, getDocs, serverTimestamp, writeBatch, arrayUnion, query, where, documentId, Timestamp
} from 'firebase/firestore';
import { db, auth } from '../../firebase/config';
import { getFunctions, httpsCallable } from "firebase/functions";
import { getGameColor, containsBlacklistedWord, ICONS, isSafeHttpUrl } from '../../utils/helpers';
import { scheduleDataRefresh } from '../../utils/appRefresh';
import { getDefaultGameId, getGame, getShareCodeLabel } from '../../utils/gamesRegistry';
import useGames from '../../hooks/useGames';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import HighlightableTextarea from '../ui/HighlightableTextarea';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import InfoBox from '../ui/InfoBox';
import SelectBackupModal from '../modals/SelectBackupModal';

// --- Sub-component: DlcSelector ---
const DlcSelector = ({ gameDlcs, selectedDlcs, onDlcChange, color }) => {
    const [isOpen, setIsOpen] = useState(false);
    const dropdownRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setIsOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={dropdownRef}>
            <label className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-2 text-center">Required DLCs (Optional)</label>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`relative w-full h-12 px-10 border rounded-lg flex justify-center items-center text-center bg-white focus:ring-2 ${color.ring}`}
            >
                <span className="text-gray-700">
                    {selectedDlcs.length === 0 ? 'Select required DLCs...' : `${selectedDlcs.length} DLC(s) selected`}
                </span>
                <Icon path={ICONS.chevronDown} className="absolute right-3 w-5 h-5 text-gray-400" />
            </button>

            {isOpen && (
                <div className="absolute top-full left-0 w-full bg-white border rounded-lg shadow-lg mt-1 z-10 max-h-60 overflow-y-auto">
                    {gameDlcs.length > 0 ? (
                        gameDlcs.map(dlc => (
                            <label key={dlc} className="flex items-center p-3 hover:bg-gray-100 cursor-pointer">
                                <input
                                    type="checkbox"
                                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                    checked={selectedDlcs.includes(dlc)}
                                    onChange={() => onDlcChange(dlc)}
                                />
                                <span className="ml-3 text-gray-700">{dlc}</span>
                            </label>
                        ))
                    ) : (
                        <p className="p-3 text-gray-500">No DLCs found for this game.</p>
                    )}
                </div>
            )}
        </div>
    );
};

// --- Sub-component: CommunityCustomFields ---
const CommunityCustomFields = ({ communities, customData, setCustomData, embedded = false }) => {
    const handleCustomDataChange = (communityId, fieldId, type, value, option) => {
        setCustomData(prevData => {
            const communityData = prevData[communityId] || {};
            let newFieldValue;
            if (type === 'checklist') {
                const checklistData = communityData[fieldId] || {};
                newFieldValue = { ...checklistData, [option]: value };
            } else {
                newFieldValue = value;
            }
            return {
                ...prevData,
                [communityId]: { ...communityData, [fieldId]: newFieldValue },
            };
        });
    };
    
    const getTextColorForBackground = (hexColor) => {
        if (!hexColor) return '#000000';
        try {
            const r = parseInt(hexColor.substr(1, 2), 16);
            const g = parseInt(hexColor.substr(3, 2), 16);
            const b = parseInt(hexColor.substr(5, 2), 16);
            const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
            return (yiq >= 128) ? '#000000' : '#ffffff';
        } catch(e) { return '#000000'; }
    };

    return (
        <div className="space-y-6">
            {communities.map(community => (
                <div key={community.id} className={embedded ? '' : 'p-4 border rounded-lg'}>
                    {!embedded && <h4 className="font-bold text-lg mb-3 border-b pb-2">{community.name} - Custom Info</h4>}
                    <div className="space-y-4">
                        {(community.customCreationFields || []).map(field => (
                            <div key={field.id}>
                                <label className="block text-sm font-bold text-gray-700 mb-1">{field.label}</label>
                                {field.type === 'textfield' && <input type="text" className="w-full p-2 border rounded-md" value={customData[community.id]?.[field.id] || ''} onChange={(e) => handleCustomDataChange(community.id, field.id, 'textfield', e.target.value)} />}
                                {field.type === 'toggle' && <div onClick={() => handleCustomDataChange(community.id, field.id, 'toggle', !(customData[community.id]?.[field.id] || false))} className="relative w-40 h-8 flex items-center rounded-full cursor-pointer p-1 transition-colors duration-300" style={{ backgroundColor: (customData[community.id]?.[field.id]) ? (field.toggleColors?.on || '#4ADE80') : (field.toggleColors?.off || '#D1D5DB') }}><div className={`absolute h-6 w-1/2 bg-white rounded-full shadow-inner transform transition-transform duration-300 top-1/2 -translate-y-1/2 ${customData[community.id]?.[field.id] ? 'translate-x-full left-0' : 'translate-x-0 left-1'}`}></div><span className="w-1/2 text-center z-10 text-sm font-semibold" style={{ color: getTextColorForBackground(field.toggleColors?.off) }}>{field.toggleLabels?.off || 'Off'}</span><span className="w-1/2 text-center z-10 text-sm font-semibold" style={{ color: getTextColorForBackground(field.toggleColors?.on) }}>{field.toggleLabels?.on || 'On'}</span></div>}
                                {field.type === 'dropdown' && <select className="w-full p-2 border rounded-md bg-white" value={customData[community.id]?.[field.id] || ''} onChange={(e) => handleCustomDataChange(community.id, field.id, 'dropdown', e.target.value)}><option value="">Select...</option>{field.options?.map(opt => <option key={opt}>{opt}</option>)}</select>}
                                {field.type === 'checklist' && <div className="space-y-2">{field.options?.map(opt => <label key={opt} className="flex items-center text-gray-700"><input type="checkbox" className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" checked={!!customData[community.id]?.[field.id]?.[opt]} onChange={(e) => handleCustomDataChange(community.id, field.id, 'checklist', e.target.checked, opt)} /><span className="ml-2">{opt}</span></label>)}</div>}
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};

const CreationCommunityCard = ({ community, selected, onSelect, customData, setCustomData }) => {
    const ranks = community.membership?.roles || [];
    const displayedRanks = (ranks.length > 0 ? ranks : ['Member']).map(role => {
        const definition = (community.ranks || []).find(rank => rank.name?.toLowerCase() === role.toLowerCase());
        return definition || { name: role, color: '#D1D5DB' };
    });
    const hasCustomFields = (community.customCreationFields || []).length > 0;
    const themeColor = community.themeColor || '#6B7280';
    const contrastText = (hex) => {
        if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return '#111827';
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
        return ((r * 299 + g * 587 + b * 114) / 1000) >= 145 ? '#111827' : '#ffffff';
    };

    return (
        <div className={`rounded-xl border-2 overflow-hidden transition-all duration-300 ${selected ? 'shadow-lg' : 'border-gray-200 dark:border-gray-700'}`} style={selected ? { borderColor: themeColor } : {}}>
            <button type="button" onClick={() => onSelect(community.id)} aria-pressed={selected} className="relative block w-full text-center bg-white dark:bg-gray-800">
                <div className="relative h-28 overflow-hidden">
                    <img src={community.bannerImageUrl || 'https://placehold.co/600x220/333333/ffffff?text=Community'} alt="" className="w-full h-full object-cover" />
                    <span className={`absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center border-2 border-white shadow font-bold transition-colors ${selected ? 'bg-blue-600 text-white' : 'bg-black/40 text-transparent'}`} aria-hidden="true">✓</span>
                </div>
                <div className="p-3">
                    <h3 className="font-bold text-lg text-gray-800 dark:text-gray-100 truncate" title={community.name}>{community.name}</h3>
                    <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 mt-2 mb-1.5">Your ranks</p>
                    <div className="flex flex-wrap justify-center gap-1.5">
                        {displayedRanks.map(rank => (
                            <span key={rank.name} className="text-xs font-semibold px-2.5 py-1 rounded-full capitalize" style={{ backgroundColor: rank.color || '#D1D5DB', color: contrastText(rank.color || '#D1D5DB') }}>
                                {rank.name}
                            </span>
                        ))}
                    </div>
                </div>
            </button>
            {selected && hasCustomFields && (
                <div className="p-4 bg-white dark:bg-gray-800 border-t dark:border-gray-700 animate-fade-in">
                    <p className="font-bold text-center text-gray-700 dark:text-gray-200 mb-4">Community-specific information</p>
                    <CommunityCustomFields communities={[community]} customData={customData} setCustomData={setCustomData} embedded />
                </div>
            )}
        </div>
    );
};

// --- Sub-component: MediaPreview ---
const MediaPreview = ({ item, onRemove, provided }) => {
    const getYoutubeThumbnail = (url) => {
        if (!url) return null;
        const videoId = url.split('v=')[1]?.split('&')[0] || url.split('/').pop();
        return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    };
    const isVideo = item.type === 'video';
    const thumbnailUrl = isVideo ? getYoutubeThumbnail(item.url) : item.url;
    return (
        <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} className="w-40 h-24 rounded-lg overflow-hidden relative group flex-shrink-0">
            <img src={thumbnailUrl} alt="Media preview" className="w-full h-full object-cover" onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/400x225/333333/ffffff?text=Error'; }}/>
            <div className="absolute inset-0 bg-black bg-opacity-30 flex items-center justify-center">
                <Icon path={isVideo ? ICONS.video : ICONS.image} className="w-8 h-8 text-white" />
            </div>
            <button type="button" onClick={() => onRemove(item.id, item.type)} className="absolute top-1 right-1 w-6 h-6 bg-black bg-opacity-50 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors opacity-0 group-hover:opacity-100">&times;</button>
        </div>
    );
};

// --- Main Component: CreationForm ---
const CreationForm = ({ user, userProfile, setModalMessage, initialGame, blacklist }) => {
    const { id: creationToEditId } = useParams(); 
    const navigate = useNavigate();
    
    const [game, setGame] = useState(creationToEditId ? '' : initialGame || getDefaultGameId());
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [shareCode, setShareCode] = useState('');
    const [customMediaLink, setCustomMediaLink] = useState('');
    const [tags, setTags] = useState('');
    const [status, setStatus] = useState('wip');
    const [platform, setPlatform] = useState('pc');
    const [category, setCategory] = useState('');
    const [changelogEntry, setChangelogEntry] = useState('');
    const [loading, setLoading] = useState(!!creationToEditId);
    const [usesMods, setUsesMods] = useState(false);
    const [mods, setMods] = useState('');
    const [requiredDlcs, setRequiredDlcs] = useState([]);
    const [gameDlcs, setGameDlcs] = useState([]);
    const [userCommunities, setUserCommunities] = useState([]);
    const [selectedCommunities, setSelectedCommunities] = useState([]);
    const [customFieldData, setCustomFieldData] = useState({});
    const [allTags, setAllTags] = useState([]);
    const [suggestedTags, setSuggestedTags] = useState([]);
    const [tagInput, setTagInput] = useState('');
    const [imageItems, setImageItems] = useState([]);
    const [videoItems, setVideoItems] = useState([]);

    const [backupInfo, setBackupInfo] = useState(null);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [isUploading, setIsUploading] = useState(false);
    const [backupUploadId, setBackupUploadId] = useState(null);
    const [hadExistingBackup, setHadExistingBackup] = useState(false);
    const [removeExistingBackup, setRemoveExistingBackup] = useState(false);
    const [isBackupModalOpen, setIsBackupModalOpen] = useState(false);
    const [isPreparingUpload, setIsPreparingUpload] = useState(false);
    const [ownershipConfirmed, setOwnershipConfirmed] = useState(false);
    const [hostingAccepted, setHostingAccepted] = useState(false);
    const [activeStep, setActiveStep] = useState('details');
    const [mobileOpen, setMobileOpen] = useState(false);
    const [completedSteps, setCompletedSteps] = useState([]);
    const [isChangingStep, setIsChangingStep] = useState(false);


    const IMAGE_LIMIT = 25;
    const VIDEO_LIMIT = 5;
    const TAG_LIMIT = 10;

    const tabRefs = useRef([]);
    const categoryTabRefs = useRef([]);
    const [gliderStyle, setGliderStyle] = useState({});
    const [categoryGliderStyle, setCategoryGliderStyle] = useState({ opacity: 0 });
    const color = getGameColor(game);

    const TABS = useGames();

    const [CATEGORIES, setCATEGORIES] = useState({});

    useEffect(() => {
        if (!game) return;
        const fetchGameData = async () => {
            const catRef = doc(db, 'categories', game);
            const dlcRef = doc(db, 'dlcs', game);
            const [catSnap, dlcSnap] = await Promise.all([getDoc(catRef), getDoc(dlcRef)]);
            
            setCATEGORIES(prev => ({ ...prev, [game]: catSnap.exists() ? catSnap.data().names || [] : [] }));
            setGameDlcs(dlcSnap.exists() ? dlcSnap.data().names || [] : []);
        };
        fetchGameData();
    }, [game]);
    
    useEffect(() => {
        if (creationToEditId) {
            const fetchCreationToEdit = async () => {
                setLoading(true);
                const docRef = doc(db, 'creations', creationToEditId);
                const docSnap = await getDoc(docRef);
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    if (data.userId !== user?.uid && userProfile?.role !== 'admin' && userProfile?.role !== 'moderator') {
                         setModalMessage("You do not have permission to edit this creation.");
                         navigate('/');
                         return;
                    }
                    setGame(data.game);
                    setTitle(data.title);
                    setDescription(data.description);
                    setShareCode(data.shareCode);
                    const loadedImages = (data.imageUrls || []).map(url => ({ id: `img-${Math.random()}`, type: 'image', url }));
                    const loadedVideos = (data.videoUrls || []).map(url => ({ id: `vid-${Math.random()}`, type: 'video', url }));
                    setImageItems(loadedImages);
                    setVideoItems(loadedVideos);
                    setCustomMediaLink(data.customMediaLink || '');
                    setTags(data.tags?.join(', ') || '');
                    setStatus(data.status || 'wip');
                    setPlatform(data.platform || 'pc');
                    setCategory(data.category || '');
                    setUsesMods(data.modStatus === 'UsingMods');
                    setMods(data.mods?.join(', ') || '');
                    setRequiredDlcs(data.requiredDlcs || []);
                    setSelectedCommunities(data.communityIds || []);
                    setCustomFieldData(data.communitySpecificData || {});
                    const hasBackup = Boolean(data.backupObjectKey || data.backupUrl);
                    setHadExistingBackup(hasBackup);
                    if (hasBackup) {
                        setBackupInfo({ name: 'Existing Backup Attached', path: null, signed: data.backupIsSigned || false });
                    }
                } else {
                    setModalMessage("Creation not found.");
                    navigate('/');
                }
                setLoading(false);
            };
            fetchCreationToEdit();
        } else {
            const ownedDlcsForGame = userProfile?.ownedDlcs?.[game] || [];
            setRequiredDlcs(ownedDlcsForGame);
        }
    }, [creationToEditId, navigate, setModalMessage, user, userProfile, game]);

    useEffect(() => {
        if (user) {
            const fetchCommunities = async () => {
                const membershipsRef = collection(db, 'profiles', user.uid, 'communityMemberships');
                const snapshot = await getDocs(membershipsRef);
                if (snapshot.empty) { setUserCommunities([]); return; }
                const communityIds = snapshot.docs.map(doc => doc.id);
                const memberships = new Map(snapshot.docs.map(membershipDoc => [membershipDoc.id, membershipDoc.data()]));
                const communityQuery = query(collection(db, 'communitys'), where(documentId(), 'in', communityIds));
                const communityDocs = await getDocs(communityQuery);
                const legacyMembershipIds = communityDocs.docs
                    .filter(cDoc => {
                        const membership = memberships.get(cDoc.id) || {};
                        return cDoc.data().ownerId !== user.uid && !Array.isArray(membership.roles) && !membership.role;
                    })
                    .map(cDoc => cDoc.id);
                const legacyMemberDocs = await Promise.all(legacyMembershipIds.map(communityId => getDoc(doc(db, 'communitys', communityId, 'members', user.uid))));
                const legacyMembers = new Map(legacyMembershipIds.map((communityId, index) => [communityId, legacyMemberDocs[index].exists() ? legacyMemberDocs[index].data() : {}]));
                const communities = communityDocs.docs.map(cDoc => {
                    const communityData = cDoc.data();
                    const membershipData = memberships.get(cDoc.id) || {};
                    const memberData = (Array.isArray(membershipData.roles) || membershipData.role)
                        ? membershipData
                        : (legacyMembers.get(cDoc.id) || membershipData);
                    const roles = Array.isArray(memberData.roles)
                        ? memberData.roles
                        : (memberData.role ? [memberData.role] : []);
                    const normalizedRoles = roles.map(role => String(role).toLowerCase());
                    if (communityData.ownerId === user.uid && !normalizedRoles.includes('owner')) normalizedRoles.unshift('owner');
                    return { id: cDoc.id, ...communityData, membership: { ...memberData, roles: normalizedRoles } };
                });
                setUserCommunities(communities);
            };
            fetchCommunities();
        } else {
            setUserCommunities([]);
        }
    }, [user]);

    // Nur Communitys anzeigen, die das aktuell gewählte Spiel unterstützen.
    // Ältere Communitys ohne allowedGames-Feld unterstützen alle Spiele.
    const visibleCommunities = useMemo(() =>
        userCommunities.filter(c => !c.allowedGames || c.allowedGames.includes(game)),
        [userCommunities, game]);

    // Beim Spielwechsel bereits gewählte, nun nicht mehr unterstützte
    // Communitys aus der Auswahl entfernen (noch nicht geladene behalten).
    useEffect(() => {
        if (userCommunities.length === 0) return;
        setSelectedCommunities(prev => prev.filter(id => {
            const community = userCommunities.find(c => c.id === id);
            if (!community) return true;
            return !community.allowedGames || community.allowedGames.includes(game);
        }));
    }, [game, userCommunities]);

    useEffect(() => {
        const fetchTags = async () => {
            const tagsCollection = collection(db, 'tags');
            const tagsSnapshot = await getDocs(tagsCollection);
            const tagsList = tagsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
            setAllTags(tagsList);
        };
        fetchTags();
    }, []);
    
    useEffect(() => {
        const currentTags = tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        if (allTags.length === 0) {
            setSuggestedTags([]);
            return;
        }
        const descriptionLower = description.toLowerCase();
        const relevantTags = allTags.filter(tag => description.trim() !== '' && descriptionLower.includes(tag.id.toLowerCase()) && !currentTags.includes(tag.id.toLowerCase())).sort((a, b) => b.count - a.count);
        const relevantTagIds = relevantTags.map(tag => tag.id);
        const otherTopTags = allTags.filter(tag => !currentTags.includes(tag.id.toLowerCase()) && !relevantTagIds.includes(tag.id)).sort((a, b) => b.count - a.count);
        const combinedSuggestions = [...relevantTags, ...otherTopTags];
        setSuggestedTags(combinedSuggestions.slice(0, 10));
    }, [description, allTags, tags]);

    const updateCategory = useCallback(() => {
        const gameCategories = CATEGORIES[game] || [];
        if (gameCategories.length > 0 && !gameCategories.includes(category)) {
            setCategory(gameCategories[0]);
        } else if (gameCategories.length === 0) {
            setCategory('');
        }
    }, [game, category, CATEGORIES]);

    useEffect(() => {
        setTimeout(() => {
            const activeTabIndex = TABS.findIndex(tab => tab.id === game);
            const activeTabRef = tabRefs.current[activeTabIndex];
            if (activeTabRef) {
                setGliderStyle({ left: activeTabRef.offsetLeft, width: activeTabRef.offsetWidth, opacity: 1 });
            }
        }, 50);
        updateCategory();
    }, [game, TABS, updateCategory]);

    useEffect(() => {
        const updateCategoryGlider = () => {
            const gameCategories = CATEGORIES[game] || [];
            const activeIndex = gameCategories.findIndex(cat => cat === category);
            const activeButton = categoryTabRefs.current[activeIndex];
            if (activeButton) {
                setCategoryGliderStyle({ left: activeButton.offsetLeft, width: activeButton.offsetWidth, opacity: 1 });
            } else {
                setCategoryGliderStyle({ opacity: 0 });
            }
        };
        const timer = setTimeout(updateCategoryGlider, 50);
        window.addEventListener('resize', updateCategoryGlider);
        return () => {
            clearTimeout(timer);
            window.removeEventListener('resize', updateCategoryGlider);
        };
    }, [game, category, CATEGORIES]);

    const handleDlcChange = (dlcName) => {
        setRequiredDlcs(prev => 
            prev.includes(dlcName) 
                ? prev.filter(d => d !== dlcName)
                : [...prev, dlcName]
        );
    };

    const handleMediaPaste = (e, mediaType) => {
        e.preventDefault();
        const pastedText = e.clipboardData.getData('text');
        const rawLinks = pastedText.split(/[\s,]+/).filter(Boolean);
        // Nur echte http(s)-URLs übernehmen (blockt javascript:/data: und Müll).
        const links = rawLinks.filter(isSafeHttpUrl);
        const rejected = rawLinks.length - links.length;
        if (rejected > 0) {
            setModalMessage(`${rejected} link(s) were ignored because they are not valid http(s) URLs.`);
        }
        const currentItems = mediaType === 'image' ? imageItems : videoItems;
        const limit = mediaType === 'image' ? IMAGE_LIMIT : VIDEO_LIMIT;
        const availableSlots = limit - currentItems.length;
        if (availableSlots <= 0) {
            setModalMessage(`You have already reached the maximum limit of ${limit} ${mediaType}s.`);
            return;
        }
        const newMedia = [];
        const linksToAdd = links.slice(0, availableSlots);
        const remainingLinks = links.slice(availableSlots);
        linksToAdd.forEach(link => {
            if(currentItems.some(item => item.url === link)) return;
            newMedia.push({ id: `${mediaType}-${Date.now()}-${Math.random()}`, type: mediaType, url: link });
        });
        if (mediaType === 'image') setImageItems(prev => [...prev, ...newMedia]);
        else setVideoItems(prev => [...prev, ...newMedia]);
        if (remainingLinks.length > 0) {
            setModalMessage(`You can only add ${limit} ${mediaType}s. ${remainingLinks.length} link(s) were not added as they exceeded the limit.`);
        }
    };
    
    const handleRemoveMedia = (idToRemove, mediaType) => {
        if (mediaType === 'image') setImageItems(prev => prev.filter(item => item.id !== idToRemove));
        else setVideoItems(prev => prev.filter(item => item.id !== idToRemove));
    };

    const handleMediaDragEnd = (result, mediaType) => {
        if (!result.destination) return;
        const items = mediaType === 'image' ? Array.from(imageItems) : Array.from(videoItems);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);
        if (mediaType === 'image') setImageItems(items);
        else setVideoItems(prev => items);
    };
    
    const handleFileSelectedForUpload = async (file) => {
        setIsBackupModalOpen(false);
        if (!file || !file.path) return;

        if (!ownershipConfirmed || !hostingAccepted) {
            setModalMessage("Please confirm that you own the creation and accept hosting before uploading it.");
            return;
        }
    
        if (!window.electronAPI) {
            setModalMessage("This feature is only available in the desktop client.");
            return;
        }
    
        setIsPreparingUpload(true);
    
        try {
            if (backupUploadId) {
                const abortPreviousUpload = httpsCallable(getFunctions(), 'abortBackupUpload');
                await abortPreviousUpload({ uploadId: backupUploadId }).catch(() => null);
                setBackupUploadId(null);
            }
            const idToken = await auth.currentUser.getIdToken(true);
            const result = await window.electronAPI.prepareBackupForUpload(file.path, idToken);
    
            if (!result.success) {
                setModalMessage(result.message || "Could not prepare backup file.");
                setIsPreparingUpload(false);
                return;
            }
    
            setBackupInfo({ name: result.fileName, path: result.filePath, signed: result.isSigned });

            const functions = getFunctions();
            const getUploadUrl = httpsCallable(functions, 'getUploadUrl');
            const { data } = await getUploadUrl({
                fileName: result.fileName,
                fileSize: result.fileSize,
                ownershipConfirmed,
                hostingAccepted,
            });

            const { uploadId, uploadUrl, contentType } = data;

            setIsPreparingUpload(false);
            setIsUploading(true);
            setUploadProgress(0);
            const uploadResult = await window.electronAPI.uploadBackupFile(
                result.filePath,
                uploadUrl,
                contentType,
            );
            if (!uploadResult?.success) {
                const abortBackupUpload = httpsCallable(functions, 'abortBackupUpload');
                await abortBackupUpload({ uploadId }).catch(() => null);
                throw new Error(uploadResult?.message || `R2 upload failed (${uploadResult?.status || 'network error'}).`);
            }
            setBackupUploadId(uploadId);
            setRemoveExistingBackup(false);
            setUploadProgress(100);
            setIsUploading(false);
            setModalMessage("Backup uploaded securely. It will be verified when you save the creation.");
        } catch (error) {
            console.error("Error during backup attachment:", error);
            setModalMessage(`An error occurred: ${error.message}`);
            setIsPreparingUpload(false);
            setIsUploading(false);
            setBackupInfo(null);
        }
    };

    const handleRemoveBackup = async () => {
        if (backupUploadId) {
            const functions = getFunctions();
            const abortBackupUpload = httpsCallable(functions, 'abortBackupUpload');
            await abortBackupUpload({ uploadId: backupUploadId })
                .catch(err => console.error("Failed to abort temporary upload:", err));
        }
        if (hadExistingBackup) setRemoveExistingBackup(true);
        setBackupUploadId(null);
        setBackupInfo(null);
        setOwnershipConfirmed(false);
        setHostingAccepted(false);
    };

    const handleAttachFileClick = () => {
        if (!ownershipConfirmed || !hostingAccepted) {
            setModalMessage("Please confirm both statements before selecting a file.");
            return;
        }
        if (window.electronAPI?.isElectron) {
            setIsBackupModalOpen(true);
        } else {
            navigate('/client-info');
        }
    };


    const hasAtLeastOneValidTag = () => tags
        .split(',')
        .map(tag => tag.trim())
        .some(tag => tag && !containsBlacklistedWord(tag, blacklist));

    const handleSubmit = async (e) => {
        e.preventDefault();

        if (!title.trim() || !description.trim() || !category || !hasAtLeastOneValidTag()) {
            setActiveStep('details');
            setMobileOpen(true);
            setModalMessage('Please complete the title, description, creation type and add at least one tag.');
            return;
        }
        if (!shareCode.trim()) {
            setActiveStep('savegame');
            setMobileOpen(true);
            setModalMessage('Please enter a share code.');
            return;
        }
        
        if (isUploading) {
            setModalMessage("Please wait for the backup upload to finish.");
            return;
        }

        // Custom Media Link wird später via window.open geöffnet — nur http(s) zulassen.
        if (customMediaLink.trim() && !isSafeHttpUrl(customMediaLink)) {
            setActiveStep('savegame');
            setMobileOpen(true);
            setModalMessage("The Custom Media Link must be a valid http(s) URL.");
            return;
        }

        setLoading(true);
        const stripBlacklisted = (text) => {
            if (!text || !blacklist.length) return text;
            const escapedBlacklist = blacklist.map(word => word.replace(/[-/^$*+?.()|[\]{}]/g, '\\$&'));
            const regex = new RegExp(`\\b(${escapedBlacklist.join('|')})\\b`, 'gi');
            return text.replace(regex, '').replace(/\s\s+/g, ' ').trim();
        };
        try {
            const finalImageUrls = imageItems.map(item => item.url);
            const finalVideoUrls = videoItems.map(item => item.url);
            const finalTags = tags.split(',').map(tag => tag.trim().toLowerCase()).filter(tag => tag && !containsBlacklistedWord(tag, blacklist)).slice(0, TAG_LIMIT);
            const finalMods = (usesMods && getGame(game)?.modsSupported) ? mods.split(',').map(mod => mod.trim().toLowerCase()).filter(Boolean) : [];
            const communityAssignments = userCommunities.filter(c => selectedCommunities.includes(c.id)).map(c => ({ communityId: c.id, communityName: c.name }));
            
            const existingTagIds = allTags.map(t => t.id);
            const newTagsToCreate = finalTags.filter(t => !existingTagIds.includes(t) && !containsBlacklistedWord(t, blacklist));
            if (newTagsToCreate.length > 0) {
                const tagBatch = writeBatch(db);
                newTagsToCreate.forEach(tag => {
                    const tagRef = doc(db, 'tags', tag);
                    tagBatch.set(tagRef, { count: 1 });
                });
                await tagBatch.commit();
            }

            const creationData = { 
                game, title: stripBlacklisted(title), description: stripBlacklisted(description), 
                shareCode: stripBlacklisted(shareCode), imageUrls: finalImageUrls, videoUrls: finalVideoUrls, 
                customMediaLink, tags: finalTags, mods: finalMods, 
                modStatus: usesMods ? 'UsingMods' : 'noMods', updatedAt: serverTimestamp(), 
                category, status, platform,
                requiredDlcs, communityIds: selectedCommunities,
                communityAssignments, communitySpecificData: customFieldData,
            };
            let savedCreationId;

            if (creationToEditId) {
                const docRef = doc(db, 'creations', creationToEditId);
                const originalDoc = await getDoc(docRef);
                const originalData = originalDoc.data();
                
                const mainUpdateData = { ...creationData };
                if (changelogEntry.trim()) {
                    mainUpdateData.changelog = arrayUnion({ text: changelogEntry.trim(), timestamp: Timestamp.now() });
                }
                
                const batch = writeBatch(db);
                batch.update(docRef, mainUpdateData);

                const originalCommunityIds = new Set(originalData.communityIds || []);
                const newCommunityIds = new Set(selectedCommunities);

                const communitiesToAdd = selectedCommunities.filter(id => !originalCommunityIds.has(id));
                communitiesToAdd.forEach(communityId => {
                    const linkRef = doc(db, 'communitys', communityId, 'creations', creationToEditId);
                    batch.set(linkRef, {
                        creationId: creationToEditId,
                        linkedAt: serverTimestamp(),
                        userId: user.uid
                    });
                });

                const communitiesToRemove = [...originalCommunityIds].filter(id => !newCommunityIds.has(id));
                communitiesToRemove.forEach(communityId => {
                    const linkRef = doc(db, 'communitys', communityId, 'creations', creationToEditId);
                    batch.delete(linkRef);
                });
                
                await batch.commit();
                savedCreationId = creationToEditId;

                if (backupUploadId) {
                    setModalMessage("Verifying and attaching the R2 backup...");
                    const finalizeBackupUpload = httpsCallable(getFunctions(), 'finalizeBackupUpload');
                    await finalizeBackupUpload({ uploadId: backupUploadId, creationId: savedCreationId });
                } else if (removeExistingBackup && hadExistingBackup) {
                    const removeCreationBackup = httpsCallable(getFunctions(), 'removeCreationBackup');
                    await removeCreationBackup({ creationId: savedCreationId });
                }

                setModalMessage("Creation updated successfully!");
                scheduleDataRefresh();
                navigate(`/creation/${creationToEditId}`);

            } else {
                const profileDoc = await getDoc(doc(db, 'profiles', user.uid));
                const newCreationData = {
                    ...creationData,
                    userId: user.uid,
                    username: profileDoc.data().username,
                    userProfilePictureUrl: profileDoc.data().profilePictureUrl || null,
                    createdAt: serverTimestamp(),
                    likes: 0, dislikes: 0, reportCount: 0,
                    eventIds: [],
                    changelog: []
                };
                
                const newDocRef = await addDoc(collection(db, 'creations'), newCreationData);
                savedCreationId = newDocRef.id;

                if (selectedCommunities.length > 0) {
                    const linkBatch = writeBatch(db);
                    selectedCommunities.forEach(communityId => {
                        const linkRef = doc(db, 'communitys', communityId, 'creations', newDocRef.id);
                        linkBatch.set(linkRef, {
                            creationId: newDocRef.id,
                            linkedAt: serverTimestamp(),
                            userId: user.uid 
                        });
                    });
                    await linkBatch.commit();
                }
                if (backupUploadId) {
                    setModalMessage("Verifying and attaching the R2 backup...");
                    const finalizeBackupUpload = httpsCallable(getFunctions(), 'finalizeBackupUpload');
                    await finalizeBackupUpload({ uploadId: backupUploadId, creationId: savedCreationId });
                }
                setModalMessage("Creation submitted successfully!");
                scheduleDataRefresh();
                navigate('/');
            }
        } catch (error) {
            console.error('Error submitting creation:', error);
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };
    
    const handleCommunitySelect = (communityId) => {
        setSelectedCommunities(prev => prev.includes(communityId) ? prev.filter(id => id !== communityId) : [...prev, communityId]);
    };
    
    const handleAddTag = (tagToAdd) => {
        const newTag = tagToAdd.trim().toLowerCase();
        if (newTag === '') return;
        const currentTags = tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
        if (currentTags.length >= TAG_LIMIT) {
            setModalMessage(`You can add a maximum of ${TAG_LIMIT} tags.`);
            return;
        }
        if (!currentTags.includes(newTag)) {
            setTags(prev => prev.trim().length > 0 ? `${prev.trim()}, ${newTag}` : newTag);
        }
    };

    const handleRemoveTag = (tagToRemove) => {
        const newTags = tags.split(',').map(t => t.trim()).filter(t => t.toLowerCase() !== tagToRemove.toLowerCase()).join(', ');
        setTags(newTags);
    };

    const handleTagKeyDown = (e) => {
        if (e.key === ' ' || e.key === ',') {
            e.preventDefault();
            handleAddTag(tagInput);
            setTagInput('');
        }
    };

    const selectedTags = tags.split(',').map(t => t.trim()).filter(Boolean);

    const WIZARD_STEPS = [
        { id: 'details', label: 'Details' },
        { id: 'savegame', label: 'Savegame' },
        { id: 'media', label: 'Gallery' },
        { id: 'sharing', label: 'Communitys' },
    ];
    const activeStepIndex = WIZARD_STEPS.findIndex(step => step.id === activeStep);
    const isLastStep = activeStepIndex === WIZARD_STEPS.length - 1;
    const activeStepLabel = WIZARD_STEPS[activeStepIndex]?.label || '';

    const goToStep = (stepId) => {
        setActiveStep(stepId);
        setMobileOpen(true);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    const isStepValid = (stepId) => {
        if (stepId === 'details') return !!(title.trim() && description.trim() && category && hasAtLeastOneValidTag());
        if (stepId === 'savegame') return !!shareCode.trim() && (!customMediaLink.trim() || isSafeHttpUrl(customMediaLink));
        return true;
    };

    const goNext = (event) => {
        event?.preventDefault();
        event?.stopPropagation();
        if (isChangingStep) return;
        if (activeStep === 'details' && (!title.trim() || !description.trim() || !category || !hasAtLeastOneValidTag())) {
            setCompletedSteps(prev => prev.filter(step => step !== activeStep));
            setModalMessage('Please complete the title, description, creation type and add at least one tag before continuing.');
            return;
        }
        if (activeStep === 'savegame' && !shareCode.trim()) {
            setCompletedSteps(prev => prev.filter(step => step !== activeStep));
            setModalMessage('Please enter a share code before continuing.');
            return;
        }
        if (activeStep === 'savegame' && customMediaLink.trim() && !isSafeHttpUrl(customMediaLink)) {
            setCompletedSteps(prev => prev.filter(step => step !== activeStep));
            setModalMessage('The Custom Media Link must be a valid http(s) URL.');
            return;
        }
        setCompletedSteps(prev => prev.includes(activeStep) ? prev : [...prev, activeStep]);
        const nextStep = WIZARD_STEPS[activeStepIndex + 1];
        if (nextStep) {
            setIsChangingStep(true);
            goToStep(nextStep.id);
            window.setTimeout(() => setIsChangingStep(false), 400);
        }
    };

    const renderTags = () => (
        <div>
            <label className="block text-gray-700 font-bold mb-2">Tags <span className="text-red-500">*</span></label>
            <div className={`w-full p-3 border rounded-lg focus-within:ring-2 ${color.ring}`}>
                <div className="flex flex-wrap gap-2 mb-2">
                    {selectedTags.map(tag => {
                        const isBlacklisted = containsBlacklistedWord(tag, blacklist);
                        return (
                            <div key={tag} className={`flex items-center text-sm font-medium px-2.5 py-1 rounded-full ${isBlacklisted ? 'bg-red-200 text-red-800 line-through' : 'bg-gray-200 text-gray-800'}`}>
                                <span>{tag}</span>
                                <button type="button" onClick={() => handleRemoveTag(tag)} className={`ml-2 ${isBlacklisted ? 'text-red-600 hover:text-red-800' : 'text-gray-500 hover:text-gray-800'}`}>{!isBlacklisted && <>&times;</>}</button>
                            </div>
                        );
                    })}
                </div>
                <input type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={handleTagKeyDown} disabled={selectedTags.length >= TAG_LIMIT} className="w-full bg-transparent focus:outline-none disabled:cursor-not-allowed" placeholder={selectedTags.length >= TAG_LIMIT ? `Maximum of ${TAG_LIMIT} tags reached.` : 'Add tags with spacebar...'} />
                {suggestedTags.length > 0 && (
                    <div className="mt-2 pt-2 border-t flex flex-wrap gap-2">
                        {suggestedTags.map(tag => (
                            <button key={tag.id} type="button" onClick={() => { handleAddTag(tag.id); setTagInput(''); }} className={`text-sm ${color.bg} ${color.hoverBg} text-white px-2.5 py-1 rounded-full transition-colors`}>{tag.id}</button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );

    if (loading && !creationToEditId) return <Spinner />;

    return (
        <div className="max-w-5xl mx-auto mt-10 px-4" style={color.style}>
            <SelectBackupModal
                isOpen={isBackupModalOpen}
                onClose={() => setIsBackupModalOpen(false)}
                onFileSelect={handleFileSelectedForUpload}
                game={game}
            />

            <h1 className="text-3xl font-bold mb-6 text-center">{creationToEditId ? 'Edit Creation' : 'Create New Creation'}</h1>
            <form onSubmit={handleSubmit}>
                <div className="lg:flex lg:gap-6 lg:items-start">
                    <nav className={`${mobileOpen ? 'hidden' : 'block'} lg:block lg:w-64 lg:flex-shrink-0`}>
                        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-md p-2">
                            {WIZARD_STEPS.map((step, index) => {
                                const active = step.id === activeStep;
                                const completed = completedSteps.includes(step.id) && isStepValid(step.id);
                                return (
                                    <button key={step.id} type="button" onClick={() => goToStep(step.id)} style={active ? { backgroundColor: color.hex, color: '#fff' } : {}} className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left mb-1 last:mb-0 transition-colors ${active ? '' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200'}`}>
                                        <span className={`w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg text-xs font-bold ${completed ? 'bg-green-500 text-white' : active ? 'bg-white/20' : 'bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-300'}`}>{completed ? '✓' : index + 1}</span>
                                        <span className="flex-grow min-w-0 font-semibold text-sm truncate">{step.label}</span>
                                        <Icon path={ICONS.chevronRight} className={`w-4 h-4 flex-shrink-0 lg:hidden ${active ? 'text-white' : 'text-gray-300'}`} />
                                    </button>
                                );
                            })}
                        </div>
                    </nav>
                    <section className={`${mobileOpen ? 'block' : 'hidden'} lg:block flex-1 min-w-0 mt-4 lg:mt-0`}>
                        <button type="button" onClick={() => setMobileOpen(false)} className="lg:hidden flex items-center gap-1 font-semibold mb-3" style={{ color: color.hex }}><Icon path={ICONS.chevronLeft} className="w-5 h-5" />All sections</button>
                        <div className="creation-form-wizard bg-white dark:bg-gray-800 rounded-2xl shadow-md p-6 sm:p-8 space-y-6">
                            <div className="relative flex items-center justify-center">
                                <h2 className="text-2xl font-bold text-center text-gray-800 dark:text-gray-100">{activeStepLabel}</h2>
                                <span className="absolute right-0 text-sm text-gray-400">{activeStepIndex + 1} / {WIZARD_STEPS.length}</span>
                            </div>
                {activeStep === 'details' && (<>
                <div className="flex justify-center my-6">
                    <div className="relative flex items-center bg-gray-200 dark:bg-gray-700 rounded-full p-1 shadow-inner overflow-x-auto">
                        <div className={`absolute h-full rounded-full ${color.bg} transition-all duration-500 ease-in-out`} style={gliderStyle} />
                        {TABS.map((tab, index) => (
                            <button key={tab.id} type="button" ref={el => tabRefs.current[index] = el} onClick={() => setGame(tab.id)} className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 font-medium whitespace-nowrap ${game === tab.id ? 'text-white' : 'text-gray-600 dark:text-gray-300 hover:text-black dark:hover:text-white'}`}>{tab.name}</button>
                        ))}
                    </div>
                </div>
                <div className="flex justify-center mb-6">
                    <div className="relative flex items-center bg-gray-200 dark:bg-gray-700 rounded-full p-1 shadow-inner w-full max-w-full overflow-hidden">
                        <div className="absolute top-1 bottom-1 rounded-full bg-white dark:bg-gray-500 shadow transition-all duration-500 ease-in-out" style={categoryGliderStyle} />
                        {(CATEGORIES[game] || []).map((cat, index) => (
                            <button key={cat} ref={el => categoryTabRefs.current[index] = el} type="button" title={cat} onClick={() => setCategory(cat)} className={`relative z-10 flex-1 min-w-0 py-2 px-1 sm:px-2 rounded-full transition-colors duration-300 font-medium text-xs sm:text-sm truncate ${category === cat ? `${color.text} dark:text-white` : 'text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-100'}`}>{cat}</button>
                        ))}
                    </div>
                </div>
                <div>
                    <div className="flex justify-center flex-wrap gap-4">
                        {getGame(game)?.platforms?.includes('console') && (<div className="flex flex-col items-center"><span className="text-sm font-medium text-gray-600 mb-1">Platform</span><div className="relative w-52 h-12 flex items-center bg-gray-200 rounded-full cursor-pointer p-1" onClick={() => setPlatform(platform === 'pc' ? 'console' : 'pc')}><div className={`absolute w-1/2 h-10 rounded-full shadow-inner transition-all duration-300 ease-in-out ${platform === 'pc' ? 'bg-blue-500 left-1' : 'bg-green-500 left-1/2 -ml-1'}`}></div><span className={`w-1/2 text-center z-10 font-semibold transition-colors duration-300 ${platform === 'pc' ? 'text-white' : 'text-gray-700'}`}>PC</span><span className={`w-1/2 text-center z-10 font-semibold transition-colors duration-300 ${platform === 'console' ? 'text-white' : 'text-gray-700'}`}>Console</span></div></div>)}
                        {getGame(game)?.modsSupported && (<div className="flex flex-col items-center"><span className="text-sm font-medium text-gray-600 mb-1">Mods</span><div className="relative w-52 h-12 flex items-center bg-gray-200 rounded-full cursor-pointer p-1" onClick={() => setUsesMods(!usesMods)}><div className={`absolute w-1/2 h-10 rounded-full shadow-inner transition-all duration-300 ease-in-out ${!usesMods ? 'bg-red-500 left-1' : 'bg-green-500 left-1/2 -ml-1'}`}></div><span className={`w-1/2 text-center z-10 font-semibold transition-colors duration-300 ${!usesMods ? 'text-white' : 'text-gray-700'}`}>No Mods</span><span className={`w-1/2 text-center z-10 font-semibold transition-colors duration-300 ${usesMods ? 'text-white' : 'text-gray-700'}`}>Using Mods</span></div></div>)}
                    </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-between gap-y-4 items-end">
                    <div className="w-full sm:w-1/4">
                        <span className="block text-sm font-bold text-gray-700 dark:text-gray-200 mb-2 text-center">Status</span>
                        <div className="relative w-full h-12 flex items-center bg-gray-200 dark:bg-gray-700 rounded-full cursor-pointer p-1" onClick={() => setStatus(status === 'wip' ? 'finished' : 'wip')}>
                            <div className={`absolute w-1/2 h-10 rounded-full shadow-inner transition-all duration-300 ease-in-out ${status === 'wip' ? 'bg-orange-500 left-1' : 'bg-green-500 left-1/2 -ml-1'}`} />
                            <span className={`w-1/2 text-center z-10 text-sm font-semibold transition-colors duration-300 ${status === 'wip' ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>WIP</span>
                            <span className={`w-1/2 text-center z-10 text-sm font-semibold transition-colors duration-300 ${status === 'finished' ? 'text-white' : 'text-gray-700 dark:text-gray-300'}`}>Finished</span>
                        </div>
                    </div>
                    <div className="w-full sm:w-[56.25%]">
                        <DlcSelector gameDlcs={gameDlcs} selectedDlcs={requiredDlcs} onDlcChange={handleDlcChange} color={color} />
                    </div>
                </div>
                <div>
                    <label className="block text-gray-700 font-bold mb-2">Title <span className="text-red-500">*</span></label>
                    <HighlightableTextarea value={title} onChange={(e) => setTitle(e.target.value)} blacklist={blacklist} rows="1" className={`w-full p-3 border rounded-lg focus:ring-2 ${color.ring}`} />
                </div>
                <div>
                    <label className="block text-gray-700 font-bold mb-2">Description <span className="text-red-500">*</span></label>
                    <HighlightableTextarea value={description} onChange={(e) => setDescription(e.target.value)} blacklist={blacklist} rows="5" className={`w-full p-3 border rounded-lg focus:ring-2 ${color.ring}`} />
                </div>
                {creationToEditId && (<div><label className="block text-gray-700 font-bold mb-2">Changelog (What's new?)</label><textarea value={changelogEntry} onChange={(e) => setChangelogEntry(e.target.value)} rows="3" className={`w-full p-3 border rounded-lg focus:ring-2 ${color.ring}`} placeholder="e.g., Added new lighting..." ></textarea></div>)}
                {renderTags()}
                
                {/* Savegame-Upload nur im Desktop-Client — im Browser komplett ausgeblendet */}
                </>)}
                {activeStep === 'savegame' && (<>
                <div>
                    <label className="block text-gray-700 font-bold mb-2">{getShareCodeLabel(game)} <span className="text-red-500">*</span></label>
                    <HighlightableTextarea value={shareCode} onChange={(e) => setShareCode(e.target.value)} blacklist={blacklist} rows="1" className={`w-full p-3 border rounded-lg focus:ring-2 ${color.ring}`} />
                </div>
                <div>
                    <label className="block text-gray-700 font-bold mb-2">Custom Media Link</label>
                    <input type="url" value={customMediaLink} onChange={(e) => setCustomMediaLink(e.target.value)} className={`w-full p-3 border rounded-lg focus:ring-2 ${color.ring}`} />
                </div>
                {window.electronAPI?.isElectron && (
                <div>
                    <label className="block text-gray-700 font-bold mb-2">Add savegame file</label>
                    <div className={`p-2 border rounded-lg transition-colors ${isUploading || isPreparingUpload ? 'bg-gray-50' : ''}`}>

                        {isPreparingUpload && (
                            <div className="flex items-center justify-center gap-2 text-gray-600 py-2">
                                <Spinner />
                                <p className="font-semibold">Preparing upload...</p>
                            </div>
                        )}

                        {!isPreparingUpload && !backupInfo && !isUploading && (
                            <div className="space-y-3">
                                <div className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-left dark:border-amber-700 dark:bg-amber-950/30">
                                    <p className="text-sm font-semibold text-gray-800 dark:text-gray-100">Required before uploading a file</p>
                                    <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
                                        <input type="checkbox" checked={ownershipConfirmed} onChange={(event) => setOwnershipConfirmed(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
                                        <span>I confirm that this is my own creation or that I have all necessary rights to upload it. <span className="text-red-500">*</span></span>
                                    </label>
                                    <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
                                        <input type="checkbox" checked={hostingAccepted} onChange={(event) => setHostingAccepted(event.target.checked)} className="mt-0.5 h-4 w-4 shrink-0" />
                                        <span>I agree that this file may be uploaded to and hosted by PlanetCreations. <span className="text-red-500">*</span></span>
                                    </label>
                                </div>
                                <button type="button" onClick={handleAttachFileClick} disabled={!ownershipConfirmed || !hostingAccepted} className={`w-full flex items-center justify-center gap-2 py-2 px-3 rounded-lg font-semibold text-white transition-colors ${ownershipConfirmed && hostingAccepted ? `${color.bg} ${color.hoverBg}` : 'cursor-not-allowed bg-gray-400 dark:bg-gray-600'}`}>
                                    <Icon path={ICONS.upload} className="w-5 h-5" />
                                    Add savegame file
                                </button>
                            </div>
                        )}

                        {!isPreparingUpload && isUploading && (
                            <div>
                                <p className="text-sm font-semibold text-gray-700 mb-1">Uploading {backupInfo.name}...</p>
                                <div className="w-full bg-gray-200 rounded-full h-2.5">
                                    <div className={`${color.bg} h-2.5 rounded-full`} style={{ width: `${uploadProgress}%` }}></div>
                                </div>
                                <p className="text-center text-sm text-gray-500 mt-1">{Math.round(uploadProgress)}%</p>
                            </div>
                        )}

                        {!isPreparingUpload && backupInfo && !isUploading && (
                            <div className="flex items-center justify-between p-2 bg-green-100 border border-green-300 rounded-lg">
                                <div className="flex items-center gap-2">
                                    <Icon path={ICONS.checkCircle} className="w-6 h-6 text-green-600" />
                                    <div>
                                        <p className="font-semibold text-green-800">{backupInfo.name}</p>
                                        <p className={`text-xs ${backupInfo.signed ? 'text-blue-600' : 'text-gray-500'}`}>{backupInfo.signed ? 'Official signed backup' : 'Local save file'}</p>
                                    </div>
                                </div>
                                <button type="button" onClick={handleRemoveBackup} className="text-red-500 hover:text-red-700 font-bold">&times;</button>
                            </div>
                        )}

                        <p className="mt-2 text-xs text-center text-gray-500">Optional — lets desktop-client users import your creation with one click.</p>
                    </div>
                </div>
                )}
                {!window.electronAPI?.isElectron && (
                    <div className="text-center py-3 px-4 border rounded-lg">
                        <Icon path={ICONS.upload} className="w-8 h-8 mx-auto text-gray-400 mb-1" />
                        <p className="font-semibold text-gray-700 dark:text-gray-200">Savegame uploads are available in the desktop client.</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">Adding a savegame is optional. You can continue without attaching one.</p>
                    </div>
                )}
                </>)}

                {activeStep === 'media' && (<>
                <div>
                    <label className="block text-gray-700 font-bold mb-2">Image URLs</label>
                    <div className="p-3 border rounded-lg">
                        <textarea
                            onPaste={(e) => handleMediaPaste(e, 'image')}
                            rows="3"
                            className="w-full p-2 border rounded-md disabled:bg-gray-100"
                            placeholder={ imageItems.length >= IMAGE_LIMIT ? `Maximum of ${IMAGE_LIMIT} images reached.` : `Paste up to ${IMAGE_LIMIT - imageItems.length} more image links here...` }
                            disabled={imageItems.length >= IMAGE_LIMIT}
                        />
                        <div className="mt-2"><InfoBox /></div>
                    </div>
                </div>

                {imageItems.length > 0 && (
                    <DragDropContext onDragEnd={(result) => handleMediaDragEnd(result, 'image')}>
                        <Droppable droppableId="image-gallery" direction="horizontal">
                            {(provided) => (
                                <div {...provided.droppableProps} ref={provided.innerRef} className="p-3 border rounded-lg bg-gray-50 flex items-center gap-4 overflow-x-auto">
                                    {imageItems.map((item, index) => (
                                        <Draggable key={item.id} draggableId={item.id} index={index}>
                                            {(provided) => (
                                                <MediaPreview item={item} onRemove={handleRemoveMedia} provided={provided} />
                                            )}
                                        </Draggable>
                                    ))}
                                    {provided.placeholder}
                                </div>
                            )}
                        </Droppable>
                    </DragDropContext>
                )}

                <div>
                    <label className="block text-gray-700 font-bold mb-2">YouTube URLs</label>
                    <div className="p-3 border rounded-lg">
                        <textarea
                            onPaste={(e) => handleMediaPaste(e, 'video')}
                            rows="3"
                            className="w-full p-2 border rounded-md disabled:bg-gray-100"
                            placeholder={ videoItems.length >= VIDEO_LIMIT ? `Maximum of ${VIDEO_LIMIT} videos reached.` : `Paste up to ${VIDEO_LIMIT - videoItems.length} more YouTube links here...` }
                            disabled={videoItems.length >= VIDEO_LIMIT}
                        />
                    </div>
                </div>

                {videoItems.length > 0 && (
                     <DragDropContext onDragEnd={(result) => handleMediaDragEnd(result, 'video')}>
                        <Droppable droppableId="video-gallery" direction="horizontal">
                            {(provided) => (
                                <div {...provided.droppableProps} ref={provided.innerRef} className="p-3 border rounded-lg bg-gray-50 flex items-center gap-4 overflow-x-auto">
                                    {videoItems.map((item, index) => (
                                        <Draggable key={item.id} draggableId={item.id} index={index}>
                                            {(provided) => (
                                                <MediaPreview item={item} onRemove={handleRemoveMedia} provided={provided} />
                                            )}
                                        </Draggable>
                                    ))}
                                    {provided.placeholder}
                                </div>
                            )}
                        </Droppable>
                     </DragDropContext>
                )}

                </>)}
                {activeStep === 'sharing' && (<>
                {visibleCommunities.length > 0 && (
                    <div>
                        <label className="block text-gray-700 font-bold mb-3 text-center">Assign to Communities</label>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-1 items-start">
                            {visibleCommunities.map(community => (
                                <CreationCommunityCard
                                    key={community.id}
                                    community={community}
                                    selected={selectedCommunities.includes(community.id)}
                                    onSelect={handleCommunitySelect}
                                    customData={customFieldData}
                                    setCustomData={setCustomFieldData}
                                />
                            ))}
                        </div>
                    </div>
                )}
                </>)}

                <div className="flex justify-between items-center gap-4 pt-6 border-t dark:border-gray-700">
                    <button type="button" onClick={() => navigate(-1)} className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2.5 px-5 rounded-xl">Cancel</button>
                    {isLastStep ? (
                        <button type="submit" disabled={loading || isUploading || isChangingStep} style={{ backgroundColor: color.hex }} className="text-white font-bold py-2.5 px-6 rounded-xl disabled:opacity-50 hover:brightness-95">
                            {loading ? 'Saving...' : (creationToEditId ? 'Save Changes' : 'Create Creation')}
                        </button>
                    ) : (
                        <button type="button" onClick={goNext} disabled={isChangingStep} style={{ backgroundColor: color.hex }} className="text-white font-bold py-2.5 px-6 rounded-xl hover:brightness-95 disabled:opacity-50 flex items-center gap-2">
                            Next <Icon path={ICONS.chevronRight} className="w-5 h-5" />
                        </button>
                    )}
                </div>
                        </div>
                    </section>
                </div>
            </form>
        </div>
    );
};

export default CreationForm;
