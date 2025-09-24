import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    addDoc,
    collection,
    doc,
    getDoc,
    getDocs,
    serverTimestamp,
    updateDoc,
    writeBatch,
    increment,
    deleteDoc
} from 'firebase/firestore';
import { db } from '../../firebase/config';
import { sendUpdateNotifications } from '../../firebase/database';
import { getGameColor } from '../../utils/helpers';
import Spinner from '../ui/Spinner';

const CreationForm = ({ user, userProfile, setView, creationToEdit, setModalMessage, initialGame }) => {
    const [game, setGame] = useState(creationToEdit?.game || initialGame || 'planet-coaster');
    const [title, setTitle] = useState(creationToEdit?.title || '');
    const [description, setDescription] = useState(creationToEdit?.description || '');
    const [shareCode, setShareCode] = useState(creationToEdit?.shareCode || '');
    const [imageUrls, setImageUrls] = useState(creationToEdit?.imageUrls || ['']);
    const [videoUrls, setVideoUrls] = useState(creationToEdit?.videoUrls || ['']);
    const [customMediaLink, setCustomMediaLink] = useState(creationToEdit?.customMediaLink || '');
    const [tags, setTags] = useState(creationToEdit?.tags?.join(', ') || '');
    const [status, setStatus] = useState(creationToEdit?.status || 'wip');
    const [category, setCategory] = useState(creationToEdit?.category || 'Park');
    const [changelogEntry, setChangelogEntry] = useState('');
    const [loading, setLoading] = useState(false);
    const [usesMods, setUsesMods] = useState(creationToEdit?.modStatus === 'UsingMods');
    const [mods, setMods] = useState(creationToEdit?.mods?.join(', ') || '');
    const color = getGameColor(game);
    
    const [allTags, setAllTags] = useState([]);
    const [suggestedTags, setSuggestedTags] = useState([]);
    const [tagInput, setTagInput] = useState('');
    const [allMods, setAllMods] = useState([]);
    const [suggestedMods, setSuggestedMods] = useState([]);
    const [modInput, setModInput] = useState('');
    
    // State for Community Assignment
    const [userCommunities, setUserCommunities] = useState([]);
    const [selectedCommunityId, setSelectedCommunityId] = useState(creationToEdit?.communityId || null);

    const dragItem = useRef(null);
    const dragOverItem = useRef(null);
    const [draggedIndex, setDraggedIndex] = useState(null);

    const initialFormState = useRef(null);

    const TABS = useRef([
        { id: 'planet-coaster', name: 'Planet Coaster' },
        { id: 'planet-coaster-2', name: 'Planet Coaster 2' },
        { id: 'planet-zoo', name: 'Planet Zoo' },
    ]).current;
    
    const CATEGORIES = useRef({
        'planet-coaster': ['Park', 'Coaster', 'Flatride', 'Scenery', 'Shop', 'Restaurant'],
        'planet-coaster-2': ['Park', 'Coaster', 'Flatride', 'Scenery', 'Shop', 'Restaurant'],
        'planet-zoo': ['Park', 'Habitat', 'Scenery', 'Shop', 'Restaurant'],
    }).current;

    const tabRefs = useRef([]);
    const categoryTabRefs = useRef([]);
    const [gliderStyle, setGliderStyle] = useState({opacity: 0});
    const [categoryGliderStyle, setCategoryGliderStyle] = useState({opacity: 0});

    // Fetch user's community memberships
    useEffect(() => {
        if (user) {
            const fetchCommunities = async () => {
                const membershipsRef = collection(db, 'profiles', user.uid, 'communityMemberships');
                const snapshot = await getDocs(membershipsRef);
                const communities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                setUserCommunities(communities);
            };
            fetchCommunities();
        }
    }, [user]);

    useEffect(() => {
        if (creationToEdit) {
            initialFormState.current = {
                // ... (existing properties)
                communityId: creationToEdit.communityId || null,
            };
        }
    }, [creationToEdit]);

    // ... (other useEffects for tags, mods, etc.)

    const handleSubmit = async (e) => {
        e.preventDefault();
        // ... (existing validation)
        
        setLoading(true);

        try {
            // ... (existing user data fetching)
            
            const creationData = { 
                // ... (existing data)
                communityId: selectedCommunityId, // Add community ID to the creation
                communityName: selectedCommunityId ? userCommunities.find(c => c.id === selectedCommunityId)?.communityName : null,
            };
            const creationsCollection = collection(db, 'creations');

            if (creationToEdit) {
                // ... (existing update logic for tags, mods, etc.)

                // Handle community link change
                const oldCommunityId = initialFormState.current?.communityId;
                const newCommunityId = selectedCommunityId;
                const batch = writeBatch(db);

                // If community was removed or changed, delete the old link
                if (oldCommunityId && oldCommunityId !== newCommunityId) {
                    const oldLinkRef = doc(db, 'communitys', oldCommunityId, 'creations', creationToEdit.id);
                    batch.delete(oldLinkRef);
                }
                // If a new community was added or changed, create the new link
                if (newCommunityId && newCommunityId !== oldCommunityId) {
                    const newLinkRef = doc(db, 'communitys', newCommunityId, 'creations', creationToEdit.id);
                    batch.set(newLinkRef, { addedAt: serverTimestamp() });
                }

                const docRef = doc(creationsCollection, creationToEdit.id);
                batch.update(docRef, creationData);
                await batch.commit();
                
                // await sendUpdateNotifications(creationToEdit.id, title);
                
                setModalMessage("Creation updated successfully!");
                setView({ name: 'detail', id: creationToEdit.id });
            } else {
                // ... (existing logic for creating new creation)

                const newDocRef = await addDoc(creationsCollection, creationData);
                // If a community was selected, create the link
                if (selectedCommunityId) {
                    const linkRef = doc(db, 'communitys', selectedCommunityId, 'creations', newDocRef.id);
                    await setDoc(linkRef, { addedAt: serverTimestamp() });
                }
                
                setModalMessage("Creation submitted successfully!");
                setView({ name: 'home' });
            }
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };
    
    const handleCommunitySelect = (communityId) => {
        if (selectedCommunityId === communityId) {
            setSelectedCommunityId(null); // Deselect if clicked again
        } else {
            setSelectedCommunityId(communityId);
        }
    };
    
    // ... (other handlers)

    return (
        <div className="max-w-4xl mx-auto mt-10 p-8 bg-white rounded-lg shadow-lg">
            {/* ... (form header and game/category selectors) */}

            <form onSubmit={handleSubmit} className="space-y-6">
                {/* ... (other form fields: Status, Title, Description, etc.) */}

                {/* NEW: Community Assignment Section */}
                {userCommunities.length > 0 && (
                    <div>
                        <label className="block text-gray-700 font-bold mb-2">Assign to Community (Optional)</label>
                        <div className="p-3 border rounded-lg flex flex-wrap gap-2">
                            {userCommunities.map(community => {
                                const isSelected = selectedCommunityId === community.id;
                                return (
                                    <button
                                        key={community.id}
                                        type="button"
                                        onClick={() => handleCommunitySelect(community.id)}
                                        className={`flex items-center text-sm font-medium px-3 py-1.5 rounded-full transition-colors ${
                                            isSelected 
                                            ? 'bg-gray-600 text-white' 
                                            : `${color.bg} ${color.hoverBg} text-white`
                                        }`}
                                    >
                                        <span>{community.communityName}</span>
                                        {isSelected && (
                                            <span className="ml-2 font-bold text-lg leading-none">&times;</span>
                                        )}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}

                <div>
                    <label className="block text-gray-700 font-bold mb-2">Tags</label>
                    {/* ... (existing tag input JSX) */}
                </div>
                
                {/* ... (rest of the form) */}
            </form>
        </div>
    );
};

export default CreateCommunityForm;
