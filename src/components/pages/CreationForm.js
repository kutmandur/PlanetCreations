import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom'; 
import {
    addDoc, collection, doc, getDoc, getDocs, serverTimestamp, updateDoc, writeBatch, arrayUnion, query, where, documentId
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getGameColor, containsBlacklistedWord, ICONS } from '../../utils/helpers';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import HighlightableTextarea from '../ui/HighlightableTextarea';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import InfoBox from '../ui/InfoBox';

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
            <label className="block text-gray-700 font-bold mb-2">Required DLCs (Optional)</label>
            <button
                type="button"
                onClick={() => setIsOpen(!isOpen)}
                className={`w-full p-3 border rounded-lg flex justify-between items-center text-left bg-white focus:ring-2 ${color.ring}`}
            >
                <span className="text-gray-700">
                    {selectedDlcs.length === 0 ? 'Select required DLCs...' : `${selectedDlcs.length} DLC(s) selected`}
                </span>
                <Icon path={ICONS.chevronDown} className="w-5 h-5 text-gray-400" />
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
const CommunityCustomFields = ({ communities, customData, setCustomData }) => {
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
                <div key={community.id} className="p-4 border rounded-lg">
                    <h4 className="font-bold text-lg mb-3 border-b pb-2">{community.name} - Custom Info</h4>
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
        <div 
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            className="w-40 h-24 rounded-lg overflow-hidden relative group flex-shrink-0"
        >
            <img src={thumbnailUrl} alt="Media preview" className="w-full h-full object-cover" 
                 onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/400x225/333333/ffffff?text=Error'; }}
            />
            <div className="absolute inset-0 bg-black bg-opacity-30 flex items-center justify-center">
                <Icon path={isVideo ? ICONS.video : ICONS.image} className="w-8 h-8 text-white" />
            </div>
            <button 
                type="button" 
                onClick={() => onRemove(item.id, item.type)}
                className="absolute top-1 right-1 w-6 h-6 bg-black bg-opacity-50 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors opacity-0 group-hover:opacity-100"
            >
                &times;
            </button>
        </div>
    );
};


// --- Main Component: CreationForm ---
const CreationForm = ({ user, userProfile, setModalMessage, initialGame, blacklist }) => {
    const { id: creationToEditId } = useParams(); 
    const navigate = useNavigate();
    
    const [game, setGame] = useState(creationToEditId ? '' : initialGame || 'planet-coaster-2');
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
    const [communityConfigs, setCommunityConfigs] = useState([]);
    const [customFieldData, setCustomFieldData] = useState({});
    const [allTags, setAllTags] = useState([]);
    const [suggestedTags, setSuggestedTags] = useState([]);
    const [tagInput, setTagInput] = useState('');
    
    const [imageItems, setImageItems] = useState([]);
    const [videoItems, setVideoItems] = useState([]);
    const IMAGE_LIMIT = 25;
    const VIDEO_LIMIT = 5;

    const tabRefs = useRef([]);
    const categoryTabRefs = useRef([]);
    const [gliderStyle, setGliderStyle] = useState({});
    const [categoryGliderStyle, setCategoryGliderStyle] = useState({});
    const color = getGameColor(game);

    const TABS = useRef([
        { id: 'planet-coaster', name: 'Planet Coaster' },
        { id: 'planet-coaster-2', name: 'Planet Coaster 2' },
        { id: 'planet-zoo', name: 'Planet Zoo' },
    ]).current;
    
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
                const communityQuery = query(collection(db, 'communitys'), where(documentId(), 'in', communityIds));
                const communityDocs = await getDocs(communityQuery);
                const communities = communityDocs.docs.map(cDoc => ({ id: cDoc.id, ...cDoc.data() }));
                setUserCommunities(communities);
            };
            fetchCommunities();
        } else {
            setUserCommunities([]);
        }
    }, [user]);

    useEffect(() => {
        const configs = userCommunities.filter(community => 
            selectedCommunities.includes(community.id) && community.customCreationFields?.length > 0
        );
        setCommunityConfigs(configs);
    }, [selectedCommunities, userCommunities]);

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
        const gameCategories = CATEGORIES[game] || [];
        if (gameCategories.length > 0) {
            setTimeout(() => {
                const activeCatIndex = gameCategories.findIndex(cat => cat === category);
                const activeCatRef = categoryTabRefs.current[activeCatIndex];
                if (activeCatRef) {
                    setCategoryGliderStyle({ left: activeCatRef.offsetLeft, width: activeCatRef.offsetWidth, opacity: 1 });
                }
            }, 50);
        } else {
            setCategoryGliderStyle({ opacity: 0 });
        }
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
        const links = pastedText.split(/[\s,]+/).filter(Boolean);
        
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
            const isDuplicate = currentItems.some(item => item.url === link);
            if(isDuplicate) return;
            newMedia.push({
                id: `${mediaType}-${Date.now()}-${Math.random()}`,
                type: mediaType,
                url: link
            });
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
        else setVideoItems(items);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        const stripBlacklisted = (text) => {
            if (!text || !blacklist.length) return text;
            const escapedBlacklist = blacklist.map(word => word.replace(/[-/\^$*+?.()|[\]{}]/g, '\\$&'));
            const regex = new RegExp(`\\b(${escapedBlacklist.join('|')})\\b`, 'gi');
            return text.replace(regex, '').replace(/\s\s+/g, ' ').trim();
        };
        try {
            const finalImageUrls = imageItems.map(item => item.url);
            const finalVideoUrls = videoItems.map(item => item.url);
            const finalTags = tags.split(',').map(tag => tag.trim().toLowerCase()).filter(tag => tag && !containsBlacklistedWord(tag, blacklist));
            const finalMods = (usesMods && game !== 'planet-coaster-2') ? mods.split(',').map(mod => mod.trim().toLowerCase()).filter(Boolean) : [];
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
            let creationData = { 
                game, 
                title: stripBlacklisted(title), 
                description: stripBlacklisted(description), 
                shareCode: stripBlacklisted(shareCode), 
                imageUrls: finalImageUrls, videoUrls: finalVideoUrls, 
                customMediaLink, tags: finalTags, mods: finalMods, 
                modStatus: usesMods ? 'UsingMods' : 'noMods', 
                updatedAt: serverTimestamp(), 
                category, status, platform,
                requiredDlcs,
                communityIds: selectedCommunities,
                communityAssignments,
                communitySpecificData: customFieldData
            };
            if (creationToEditId) {
                const docRef = doc(db, 'creations', creationToEditId);
                const mainUpdateData = { ...creationData };
                
                if (changelogEntry.trim()) {
                    mainUpdateData.changelog = arrayUnion({ text: changelogEntry.trim(), timestamp: serverTimestamp() });
                }
                
                await updateDoc(docRef, mainUpdateData);
                setModalMessage("Creation updated successfully!");
                navigate(`/creation/${creationToEditId}`);
            } else {
                const profileDoc = await getDoc(doc(db, 'profiles', user.uid));
                creationData = {
                    ...creationData,
                    userId: user.uid,
                    username: profileDoc.data().username,
                    userProfilePictureUrl: profileDoc.data().profilePictureUrl || null,
                    createdAt: serverTimestamp(),
                    likes: 0, dislikes: 0, reportCount: 0,
                    eventIds: [],
                    changelog: []
                };
                
                const newDocRef = await addDoc(collection(db, 'creations'), creationData);
                
                if (selectedCommunities.length > 0) {
                    const linkBatch = writeBatch(db);
                    selectedCommunities.forEach(communityId => {
                        const linkRef = doc(db, 'communitys', communityId, 'creations', newDocRef.id);
                        linkBatch.set(linkRef, { addedAt: serverTimestamp(), userId: user.uid });
                    });
                    await linkBatch.commit();
                }
                setModalMessage("Creation submitted successfully!");
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

    if (loading) return <Spinner />;

    return (
        <div className="max-w-4xl mx-auto mt-10 p-8 bg-white rounded-lg shadow-lg">
            <h2 className="text-3xl font-bold mb-6 text-center">{creationToEditId ? 'Edit Creation' : 'New Creation'}</h2>
            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="flex justify-center my-6">
                    <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner">
                        <div className={`absolute h-full rounded-full ${color.bg} transition-all duration-500 ease-in-out`} style={gliderStyle} />
                        {TABS.map((tab, index) => (
                            <button key={tab.id} type="button" ref={el => tabRefs.current[index] = el} onClick={() => setGame(tab.id)} className={`relative z-10 py-2 px-6 rounded-full transition-colors duration-300 font-medium ${game === tab.id ? 'text-white' : 'text-gray-600 hover:text-black'}`}>{tab.name}</button>
                        ))}
                    </div>
                </div>
                <div className="flex justify-center mb-6">
                    <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner overflow-x-auto">
                        <div className="absolute h-full rounded-full bg-white transition-all duration-500 ease-in-out shadow" style={categoryGliderStyle} />
                        {(CATEGORIES[game] || []).map((cat, index) => (
                            <button key={cat} type="button" ref={el => categoryTabRefs.current[index] = el} onClick={() => setCategory(cat)} className={`relative z-10 py-2 px-6 rounded-full transition-colors duration-300 font-medium text-sm whitespace-nowrap ${category === cat ? color.text : 'text-gray-500 hover:text-gray-800'}`}>{cat}</button>
                        ))}
                    </div>
                </div>
                <div>
                    <label className="block text-gray-700 font-bold mb-2 text-center">Options</label>
                    <div className="flex justify-center flex-wrap gap-4">
                        <div className="flex flex-col items-center"><span className="text-sm font-medium text-gray-600 mb-1">Status</span><div className="relative w-52 h-12 flex items-center bg-gray-200 rounded-full cursor-pointer p-1" onClick={() => setStatus(status === 'wip' ? 'finished' : 'wip')}><div className={`absolute w-1/2 h-10 rounded-full shadow-inner transition-all duration-300 ease-in-out ${status === 'wip' ? 'bg-orange-500 left-1' : 'bg-green-500 left-1/2 -ml-1'}`}></div><span className={`w-1/2 text-center z-10 font-semibold transition-colors duration-300 ${status === 'wip' ? 'text-white' : 'text-gray-700'}`}>WIP</span><span className={`w-1/2 text-center z-10 font-semibold transition-colors duration-300 ${status === 'finished' ? 'text-white' : 'text-gray-700'}`}>Finished</span></div></div>
                        {(game === 'planet-coaster' || game === 'planet-zoo') && (<><div className="flex flex-col items-center"><span className="text-sm font-medium text-gray-600 mb-1">Platform</span><div className="relative w-52 h-12 flex items-center bg-gray-200 rounded-full cursor-pointer p-1" onClick={() => setPlatform(platform === 'pc' ? 'console' : 'pc')}><div className={`absolute w-1/2 h-10 rounded-full shadow-inner transition-all duration-300 ease-in-out ${platform === 'pc' ? 'bg-blue-500 left-1' : 'bg-green-500 left-1/2 -ml-1'}`}></div><span className={`w-1/2 text-center z-10 font-semibold transition-colors duration-300 ${platform === 'pc' ? 'text-white' : 'text-gray-700'}`}>PC</span><span className={`w-1/2 text-center z-10 font-semibold transition-colors duration-300 ${platform === 'console' ? 'text-white' : 'text-gray-700'}`}>Console</span></div></div><div className="flex flex-col items-center"><span className="text-sm font-medium text-gray-600 mb-1">Mods</span><div className="relative w-52 h-12 flex items-center bg-gray-200 rounded-full cursor-pointer p-1" onClick={() => setUsesMods(!usesMods)}><div className={`absolute w-1/2 h-10 rounded-full shadow-inner transition-all duration-300 ease-in-out ${!usesMods ? 'bg-red-500 left-1' : 'bg-green-500 left-1/2 -ml-1'}`}></div><span className={`w-1/2 text-center z-10 font-semibold transition-colors duration-300 ${!usesMods ? 'text-white' : 'text-gray-700'}`}>No Mods</span><span className={`w-1/2 text-center z-10 font-semibold transition-colors duration-300 ${usesMods ? 'text-white' : 'text-gray-700'}`}>Using Mods</span></div></div></>)}
                    </div>
                </div>
                <DlcSelector gameDlcs={gameDlcs} selectedDlcs={requiredDlcs} onDlcChange={handleDlcChange} color={color} />
                <div>
                    <label className="block text-gray-700 font-bold mb-2">Title</label>
                    <HighlightableTextarea value={title} onChange={(e) => setTitle(e.target.value)} blacklist={blacklist} rows="1" className={`w-full p-3 border rounded-lg focus:ring-2 ${color.ring}`} required />
                </div>
                <div>
                    <label className="block text-gray-700 font-bold mb-2">Description</label>
                    <HighlightableTextarea value={description} onChange={(e) => setDescription(e.target.value)} blacklist={blacklist} rows="5" className={`w-full p-3 border rounded-lg focus:ring-2 ${color.ring}`} required />
                </div>
                {creationToEditId && (<div><label className="block text-gray-700 font-bold mb-2">Changelog (What's new?)</label><textarea value={changelogEntry} onChange={(e) => setChangelogEntry(e.target.value)} rows="3" className={`w-full p-3 border rounded-lg focus:ring-2 ${color.ring}`} placeholder="e.g., Added new lighting..." ></textarea></div>)}
                
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

                <div>
                    <label className="block text-gray-700 font-bold mb-2">Share Code</label>
                    <HighlightableTextarea value={shareCode} onChange={(e) => setShareCode(e.target.value)} blacklist={blacklist} rows="1" className={`w-full p-3 border rounded-lg focus:ring-2 ${color.ring}`} required />
                </div>
                <div><label className="block text-gray-700 font-bold mb-2">Custom Media Link</label><input type="url" value={customMediaLink} onChange={(e) => setCustomMediaLink(e.target.value)} className={`w-full p-3 border rounded-lg focus:ring-2 ${color.ring}`} /></div>
                
                <div>
                    <label className="block text-gray-700 font-bold mb-2">Tags</label>
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
                        <input type="text" value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={handleTagKeyDown} className="w-full bg-transparent focus:outline-none" placeholder="Add tags with spacebar..." />
                        {suggestedTags.length > 0 && (
                            <div className="mt-2 pt-2 border-t flex flex-wrap gap-2">
                                {suggestedTags.map(tag => (
                                    <button key={tag.id} type="button" onClick={() => { handleAddTag(tag.id); setTagInput(''); }} className={`text-sm ${color.bg} ${color.hoverBg} text-white px-2.5 py-1 rounded-full transition-colors`}>
                                        {tag.id}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {userCommunities.length > 0 && (<div><label className="block text-gray-700 font-bold mb-2">Assign to Communities</label><div className="p-3 border rounded-lg flex flex-wrap gap-2">{userCommunities.map(c => <button key={c.id} type="button" onClick={() => handleCommunitySelect(c.id)} className={`flex items-center text-sm font-medium px-3 py-1.5 rounded-full transition-colors ${selectedCommunities.includes(c.id) ? 'bg-blue-600 text-white ring-2 ring-offset-1 ring-blue-600' : 'bg-gray-200 text-gray-800 hover:bg-gray-300'}`}><span>{c.name}</span></button>)}</div></div>)}
                {communityConfigs.length > 0 && (<CommunityCustomFields communities={communityConfigs} customData={customFieldData} setCustomData={setCustomFieldData} />)}
                <div className="flex space-x-4 pt-4">
                    <button type="submit" disabled={loading} className={`w-full ${color.bg} ${color.hoverBg} text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50 transition-colors`}>{loading ? <Spinner size="small" /> : (creationToEditId ? 'Save Changes' : 'Submit Creation')}</button>
                    <button type="button" onClick={() => navigate(-1)} className="w-full bg-gray-500 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-lg transition-colors">Cancel</button>
                </div>
            </form>
        </div>
    );
};

export default CreationForm;