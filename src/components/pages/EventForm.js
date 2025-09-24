import { React, useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { db } from '../../firebase/config';
import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp, updateDoc, arrayUnion } from 'firebase/firestore';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import InfoBox from '../ui/InfoBox';
import { ICONS, getGameColor } from '../../utils/helpers';

// --- Sub-component: RuleEditor ---
const RuleEditor = ({ rules, setRules }) => {
    const [newRule, setNewRule] = useState('');

    const handleAddRule = () => {
        if (newRule.trim()) {
            const newRuleObject = { id: `rule-${Date.now()}`, text: newRule.trim() };
            setRules(prev => [...prev, newRuleObject]);
            setNewRule('');
        }
    };

    const handleRemoveRule = (index) => {
        setRules(prev => prev.filter((_, i) => i !== index));
    };

    const handleOnDragEnd = (result) => {
        if (!result.destination) return;
        const items = Array.from(rules);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);
        setRules(items);
    };

    return (
        <div>
            <label className="block text-gray-700 font-bold mb-2">Rules</label>
            <div className="p-4 border rounded-lg bg-gray-50">
                <DragDropContext onDragEnd={handleOnDragEnd}>
                    <Droppable droppableId="rules">
                        {(provided) => (
                            <div {...provided.droppableProps} ref={provided.innerRef}>
                                {rules.map((rule, index) => (
                                    <Draggable key={rule.id} draggableId={rule.id} index={index}>
                                        {(provided) => (
                                            <div
                                                ref={provided.innerRef}
                                                {...provided.draggableProps}
                                                {...provided.dragHandleProps}
                                                className="flex items-center bg-white p-2 mb-2 rounded shadow"
                                            >
                                                <Icon path={ICONS.dragHandle} className="w-5 h-5 text-gray-400 mr-3" />
                                                <p className="flex-grow text-gray-800">{rule.text}</p>
                                                <button type="button" onClick={() => handleRemoveRule(index)} className="text-red-500 hover:text-red-700 font-bold p-1">&times;</button>
                                            </div>
                                        )}
                                    </Draggable>
                                ))}
                                {provided.placeholder}
                            </div>
                        )}
                    </Droppable>
                </DragDropContext>
                <div className="flex space-x-2 mt-4">
                    <input
                        type="text"
                        value={newRule}
                        onChange={(e) => setNewRule(e.target.value)}
                        placeholder="Add a new rule..."
                        className="flex-grow p-2 border rounded-lg"
                    />
                    <button type="button" onClick={handleAddRule} className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg">Add</button>
                </div>
            </div>
        </div>
    );
};

// --- Sub-component: CustomFieldsEditor ---
const CustomFieldsEditor = ({ fields, setCustomFields }) => {
    const addField = () => {
        if (fields.length < 5) {
            setCustomFields(prev => [...prev, { id: `field-${Date.now()}`, label: '', required: true }]);
        }
    };

    const updateField = (index, key, value) => {
        const newFields = [...fields];
        newFields[index][key] = value;
        setCustomFields(newFields);
    };

    const removeField = (index) => {
        setCustomFields(prev => prev.filter((_, i) => i !== index));
    };

    const handleOnDragEnd = (result) => {
        if (!result.destination) return;
        const items = Array.from(fields);
        const [reorderedItem] = items.splice(result.source.index, 1);
        items.splice(result.destination.index, 0, reorderedItem);
        setCustomFields(items);
    };

    return (
        <div>
            <label className="block text-gray-700 font-bold mb-2">Custom Entry Fields</label>
            <div className="p-4 border rounded-lg bg-gray-50 space-y-3">
                <DragDropContext onDragEnd={handleOnDragEnd}>
                    <Droppable droppableId="customFields">
                        {(provided) => (
                            <div {...provided.droppableProps} ref={provided.innerRef}>
                                {fields.map((field, index) => (
                                    <Draggable key={field.id} draggableId={field.id} index={index}>
                                        {(provided) => (
                                            <div 
                                                ref={provided.innerRef}
                                                {...provided.draggableProps}
                                                className="flex items-center space-x-3 bg-white p-2 rounded shadow"
                                            >
                                                <div {...provided.dragHandleProps}>
                                                    <Icon path={ICONS.dragHandle} className="w-5 h-5 text-gray-400 cursor-grab" />
                                                </div>
                                                <input
                                                    type="text"
                                                    value={field.label}
                                                    onChange={(e) => updateField(index, 'label', e.target.value)}
                                                    placeholder={`Custom Field #${index + 1}`}
                                                    className="flex-grow p-2 border rounded-lg"
                                                />
                                                <div className="flex items-center space-x-2">
                                                    <span className={`text-xs font-semibold ${field.required ? 'text-green-600' : 'text-gray-500'}`}>
                                                        {field.required ? 'Required' : 'Optional'}
                                                    </span>
                                                    <div
                                                        className="relative w-12 h-6 flex items-center rounded-full cursor-pointer p-1"
                                                        onClick={() => updateField(index, 'required', !field.required)}
                                                        style={{ backgroundColor: field.required ? '#34D399' : '#D1D5DB' }}
                                                    >
                                                        <div className={`absolute bg-white w-4 h-4 rounded-full shadow-md transform transition-transform duration-300 ${field.required ? 'translate-x-6' : 'translate-x-0'}`}></div>
                                                    </div>
                                                </div>
                                                <button type="button" onClick={() => removeField(index)} className="text-red-500 hover:text-red-700 font-bold p-1">&times;</button>
                                            </div>
                                        )}
                                    </Draggable>
                                ))}
                                {provided.placeholder}
                            </div>
                        )}
                    </Droppable>
                </DragDropContext>
                {fields.length < 5 && (
                    <button type="button" onClick={addField} className="text-sm text-blue-500 hover:underline mt-3">
                        + Add Custom Field
                    </button>
                )}
            </div>
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

// --- Main Component: EventForm ---
const EventForm = ({ user, setModalMessage }) => {
    const { eventId, communityId } = useParams();
    const navigate = useNavigate();
    const isEditing = !!eventId;

    const formatDateForLocalInput = (date = new Date()) => {
        const offset = date.getTimezoneOffset() * 60000;
        const localDate = new Date(date.getTime() - offset);
        return localDate.toISOString().slice(0, 16);
    };

    const [loading, setLoading] = useState(true);
    const [communityName, setCommunityName] = useState('');
    const [game, setGame] = useState('planet-coaster-2');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [bannerImageUrl, setBannerImageUrl] = useState('');
    const [rules, setRules] = useState([]);
    const [customFields, setCustomFields] = useState([]);
    const [startDate, setStartDate] = useState('');
    const [endDatePart, setEndDatePart] = useState('');
    const [endTimePart, setEndTimePart] = useState('12:00');
    const [separateVoteTime, setSeparateVoteTime] = useState(false);
    const [voteStartDate, setVoteStartDate] = useState('');
    const [voteEndDatePart, setVoteEndDatePart] = useState('');
    const [voteEndTimePart, setVoteEndTimePart] = useState('12:00');
    const [timezone, setTimezone] = useState('');
    const [originalEventDates, setOriginalEventDates] = useState(null);
    const [status, setStatus] = useState('visible');
    const [allowMultipleSubmissions, setAllowMultipleSubmissions] = useState(false);
    const [submissionLimit, setSubmissionLimit] = useState(1);
    const [blockOldCreations, setBlockOldCreations] = useState(false);
    const [creationCutoffDate, setCreationCutoffDate] = useState('');
    const [eventClasses, setEventClasses] = useState([]);
    const [classInput, setClassInput] = useState('');
    const [allCommunityClasses, setAllCommunityClasses] = useState([]);
    const [suggestedClasses, setSuggestedClasses] = useState([]);
    const [reminders, setReminders] = useState(['none', 'none', 'none']);
    const [voteReminders, setVoteReminders] = useState(['none', 'none', 'none']);
    const [voteType, setVoteType] = useState('single');
    const [voteLimit, setVoteLimit] = useState(1);
    
    const [imageItems, setImageItems] = useState([]);
    const [videoItems, setVideoItems] = useState([]);
    const IMAGE_LIMIT = 10;
    const VIDEO_LIMIT = 3;

    const REMINDER_OPTIONS = [
        { value: 'none', label: 'Deactivated' },
        ...Array.from({ length: 24 }, (_, i) => ({ value: `${i + 1}h`, label: `${i + 1} Hour(s) Before` })),
        ...Array.from({ length: 5 }, (_, i) => ({ value: `${i + 1}d`, label: `${i + 1} Day(s) Before` })),
    ];

    const timezones = Intl.supportedValuesOf('timeZone');
    const color = getGameColor(game);
    const tabRefs = useRef([]);
    const gliderRef = useRef(null);
    const TABS = useRef([
        { id: 'planet-coaster', name: 'Planet Coaster' },
        { id: 'planet-coaster-2', name: 'Planet Coaster 2' },
        { id: 'planet-zoo', name: 'Planet Zoo' },
    ]).current;

    const formatDateForInput = (date, tz) => {
        try {
            const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).formatToParts(date);
            const partMap = parts.reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
            return `${partMap.year}-${partMap.month}-${partMap.day}T${partMap.hour}:${partMap.minute}`;
        } catch (e) { return formatDateForLocalInput(date); }
    };

    useEffect(() => {
        const loadFormData = async () => {
            const browserTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
            let effectiveCommunityId = communityId;

            try {
                if (isEditing) {
                    const eventRef = doc(db, 'events', eventId);
                    const eventSnap = await getDoc(eventRef);
                    if (!eventSnap.exists()) {
                        setModalMessage("Event not found."); navigate(-1); return;
                    }
                    const data = eventSnap.data();
                    const eventTimezone = data.timezone || browserTimezone;
                    setTimezone(eventTimezone);
                    setTitle(data.title);
                    setDescription(data.description);
                    setBannerImageUrl(data.bannerImageUrl || '');
                    setRules(data.rules || []);
                    const loadedImages = (data.imageUrls || []).map(url => ({ id: `img-${Math.random()}`, type: 'image', url }));
                    const loadedVideos = (data.videoUrls || []).map(url => ({ id: `vid-${Math.random()}`, type: 'video', url }));
                    setImageItems(loadedImages);
                    setVideoItems(loadedVideos);
                    setStatus(data.status || 'visible');
                    setCustomFields(data.customFields || []);
                    setAllowMultipleSubmissions(data.allowMultipleSubmissions || false);
                    setSubmissionLimit(data.submissionLimit || 1);
                    setBlockOldCreations(data.blockOldCreations || false);
                    setGame(data.game || 'planet-coaster-2');
                    setEventClasses(data.classes || []);
                    setVoteType(data.voteType || 'single');
                    setVoteLimit(data.voteLimit || 1);
                    const existingReminders = data.reminders || [];
                    const paddedReminders = [...existingReminders];
                    while (paddedReminders.length < 3) { paddedReminders.push('none'); }
                    setReminders(paddedReminders.slice(0, 3));
                    const existingVoteReminders = data.voteReminders || [];
                    const paddedVoteReminders = [...existingVoteReminders];
                    while (paddedVoteReminders.length < 3) { paddedVoteReminders.push('none'); }
                    setVoteReminders(paddedVoteReminders.slice(0, 3));
                    if (data.startDate && data.endDate) {
                        const start = data.startDate.toDate();
                        const end = data.endDate.toDate();
                        setOriginalEventDates({ start, end });
                        setStartDate(formatDateForInput(start, eventTimezone));
                        const endString = formatDateForInput(end, eventTimezone);
                        setEndDatePart(endString.split('T')[0]);
                        setEndTimePart(endString.split('T')[1]);
                    }
                    setSeparateVoteTime(data.separateVoteTime || false);
                    if (data.voteStartDate) {
                        setVoteStartDate(formatDateForInput(data.voteStartDate.toDate(), eventTimezone));
                    }
                    if (data.voteEndDate) {
                        const voteEndString = formatDateForInput(data.voteEndDate.toDate(), eventTimezone);
                        setVoteEndDatePart(voteEndString.split('T')[0]);
                        setVoteEndTimePart(voteEndString.split('T')[1]);
                    }
                    if (data.creationCutoffDate) setCreationCutoffDate(new Date(data.creationCutoffDate.seconds * 1000).toISOString().slice(0, 10));
                    effectiveCommunityId = data.communityId;
                } else {
                    setTimezone(browserTimezone);
                    setStartDate(formatDateForLocalInput());
                    setVoteStartDate(formatDateForLocalInput());
                }

                if (effectiveCommunityId) {
                    const communityRef = doc(db, 'communitys', effectiveCommunityId);
                    const communitySnap = await getDoc(communityRef);
                    if (communitySnap.exists()) {
                        setCommunityName(communitySnap.data().name);
                        setAllCommunityClasses(communitySnap.data().eventClasses || []);
                    }
                }
            } catch (error) { setModalMessage("Failed to load form data."); } 
            finally { setLoading(false); }
        };
        loadFormData();
    }, [eventId, communityId, isEditing, navigate, setModalMessage]);

    useEffect(() => {
        if (isEditing && originalEventDates && timezone) {
            const { start, end } = originalEventDates;
            setStartDate(formatDateForInput(start, timezone));
            const endString = formatDateForInput(end, timezone);
            setEndDatePart(endString.split('T')[0]);
            setEndTimePart(endString.split('T')[1]);
        }
    }, [timezone, isEditing, originalEventDates]);
    
    useEffect(() => {
        const currentSelected = eventClasses.map(c => c.toLowerCase());
        if (classInput.trim() === '') {
            const initialSuggestions = allCommunityClasses.filter(c => !currentSelected.includes(c.toLowerCase())).slice(0, 5);
            setSuggestedClasses(initialSuggestions);
        } else {
            const lowerClassInput = classInput.toLowerCase();
            const suggestions = allCommunityClasses.filter(c => c.toLowerCase().includes(lowerClassInput) && !currentSelected.includes(c.toLowerCase()));
            setSuggestedClasses(suggestions.slice(0, 5));
        }
    }, [classInput, allCommunityClasses, eventClasses]);
    
    useEffect(() => {
        if (loading) return;
        const activeTabIndex = TABS.findIndex(tab => tab.id === game);
        const activeTabNode = tabRefs.current[activeTabIndex];
        if (activeTabNode && gliderRef.current) {
            gliderRef.current.style.left = `${activeTabNode.offsetLeft}px`;
            gliderRef.current.style.width = `${activeTabNode.offsetWidth}px`;
        }
    }, [game, TABS, loading]);

    const handleAddClass = (classToAdd) => {
        const newClass = classToAdd.trim();
        if (newClass && !eventClasses.some(ec => ec.toLowerCase() === newClass.toLowerCase()) && eventClasses.length < 3) {
            setEventClasses([...eventClasses, newClass]);
        }
        setClassInput('');
    };

    const handleRemoveClass = (classToRemove) => {
        setEventClasses(eventClasses.filter(c => c !== classToRemove));
    };

    const handleClassKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            handleAddClass(classInput);
        }
    };

    const handleReminderChange = (index, value) => {
        const newReminders = [...reminders];
        newReminders[index] = value;
        setReminders(newReminders);
    };

    const handleVoteReminderChange = (index, value) => {
        const newVoteReminders = [...voteReminders];
        newVoteReminders[index] = value;
        setVoteReminders(newVoteReminders);
    };

    const handleEndTimeChange = (e, setTimePart) => {
        const newTime = e.target.value;
        const hour = newTime.split(':')[0];
        const snappedTime = `${hour.padStart(2, '0')}:00`;
        setTimePart(snappedTime);
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
            if(currentItems.some(item => item.url === link)) return;
            newMedia.push({ id: `${mediaType}-${Date.now()}-${Math.random()}`, type: mediaType, url: link });
        });
        if (mediaType === 'image') setImageItems(prev => [...prev, ...newMedia]);
        else setVideoItems(prev => [...prev, ...newMedia]);
        if (remainingLinks.length > 0) {
            setModalMessage(`You can only add ${limit} ${mediaType}s. ${remainingLinks.length} link(s) were not added.`);
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

        const finalReminders = reminders.filter(r => r !== 'none');
        const finalVoteReminders = voteReminders.filter(r => r !== 'none');
        const finalEndDate = `${endDatePart}T${endTimePart}`;
        const finalVoteEndDate = separateVoteTime ? `${voteEndDatePart}T${voteEndTimePart}` : finalEndDate;
        const finalVoteStartDate = separateVoteTime ? new Date(voteStartDate) : new Date(startDate);
        const finalImageUrls = imageItems.map(item => item.url);
        const finalVideoUrls = videoItems.map(item => item.url);
        
        const eventData = {
            title, description, rules,
            imageUrls: finalImageUrls,
            videoUrls: finalVideoUrls,
            bannerImageUrl: bannerImageUrl,
            startDate: new Date(startDate),
            endDate: new Date(finalEndDate),
            separateVoteTime,
            voteStartDate: finalVoteStartDate,
            voteEndDate: new Date(finalVoteEndDate),
            timezone, status, customFields, allowMultipleSubmissions,
            submissionLimit: allowMultipleSubmissions ? Number(submissionLimit) : 1,
            blockOldCreations,
            creationCutoffDate: blockOldCreations ? new Date(creationCutoffDate) : null,
            game,
            communityId: isEditing ? (await getDoc(doc(db, 'events', eventId))).data().communityId : communityId,
            creatorId: user.uid,
            updatedAt: serverTimestamp(),
            classes: eventClasses,
            reminders: finalReminders,
            voteReminders: separateVoteTime ? finalVoteReminders : [],
            voteType: voteType,
            voteLimit: voteType === 'multiple' ? Number(voteLimit) : 1,
            notificationsSent: { start: false, end: false, voteEnd: false },
        };

        try {
            const newClasses = eventClasses.filter(c => !allCommunityClasses.some(ac => ac.toLowerCase() === c.toLowerCase()));
            if (newClasses.length > 0) {
                const communityRef = doc(db, 'communitys', eventData.communityId);
                await updateDoc(communityRef, {
                    eventClasses: arrayUnion(...newClasses)
                });
            }

            if (isEditing) {
                const eventRef = doc(db, 'events', eventId);
                const originalEvent = await getDoc(eventRef);
                if (originalEvent.exists()) {
                    const originalData = originalEvent.data();
                    if (new Date(finalEndDate).getTime() === originalData.endDate.toDate().getTime()) {
                        eventData.sentReminders = originalData.sentReminders || [];
                    } else { eventData.sentReminders = []; }
                    if (new Date(startDate).getTime() === originalData.startDate.toDate().getTime()) {
                        eventData.notificationsSent.start = originalData.notificationsSent?.start || false;
                    }
                    if (new Date(finalEndDate).getTime() === originalData.endDate.toDate().getTime()) {
                        eventData.notificationsSent.end = originalData.notificationsSent?.end || false;
                    }
                    if (new Date(finalVoteEndDate).getTime() === originalData.voteEndDate?.toDate().getTime()) {
                        eventData.notificationsSent.voteEnd = originalData.notificationsSent?.voteEnd || false;
                    }
                }
                await setDoc(eventRef, { ...eventData, createdAt: originalEvent.data()?.createdAt || serverTimestamp() }, { merge: true });
                setModalMessage("Event updated successfully!");
                navigate(`/event/${eventId}`);
            } else {
                const newEventRef = await addDoc(collection(db, 'events'), { ...eventData, createdAt: serverTimestamp() });
                setModalMessage("Event created successfully!");
                navigate(`/event/${newEventRef.id}`);
            }
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    if (loading) return <div className="h-screen flex justify-center items-center"><Spinner /></div>;

    return (
        <div className="max-w-2xl mx-auto mt-10 p-8 bg-white rounded-lg shadow-lg">
            <h1 className="text-3xl font-bold text-center">{isEditing ? 'Edit Event' : 'Create New Event'}</h1>
            {communityName && (
                <div className="text-center mb-6 text-gray-500">
                    for <span className="font-bold" style={{ color: color.text }}>{communityName}</span>
                </div>
            )}
            <form onSubmit={handleSubmit} className="space-y-6">
                <div className="flex justify-center my-6">
                    <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner">
                        <div ref={gliderRef} className={`absolute h-full rounded-full ${color.bg} transition-all duration-500 ease-in-out`} />
                        {TABS.map((tab, index) => (
                            <button
                                key={tab.id}
                                type="button"
                                ref={el => tabRefs.current[index] = el}
                                onClick={() => setGame(tab.id)}
                                className={`relative z-10 py-2 px-6 rounded-full transition-colors duration-300 font-medium ${game === tab.id ? 'text-white' : 'text-gray-600 hover:text-black'}`}
                            >
                                {tab.name}
                            </button>
                        ))}
                    </div>
                </div>

                <div><label className="block text-gray-700 font-bold mb-2">Event Title</label><input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="w-full p-3 border rounded-lg" required /></div>
                
                <div>
                    <label className="block text-gray-700 font-bold mb-2">Banner Image URL</label>
                    <input type="url" value={bannerImageUrl} onChange={(e) => setBannerImageUrl(e.target.value)} className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" placeholder="https://..." />
                    <div className="mt-2"><InfoBox /></div>
                </div>

                <div><label className="block text-gray-700 font-bold mb-2">Description</label><textarea value={description} onChange={(e) => setDescription(e.target.value)} rows="5" className="w-full p-3 border rounded-lg" required></textarea></div>

                <div>
                    <label className="block text-gray-700 font-bold mb-2">Event Gallery Images</label>
                    <div className="p-3 border rounded-lg">
                        <textarea
                            onPaste={(e) => handleMediaPaste(e, 'image')}
                            rows="3"
                            className="w-full p-2 border rounded-md disabled:bg-gray-100"
                            placeholder={ imageItems.length >= IMAGE_LIMIT ? `Maximum of ${IMAGE_LIMIT} images reached.` : `Paste up to ${IMAGE_LIMIT - imageItems.length} image links...` }
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
                                            {(provided) => ( <MediaPreview item={item} onRemove={handleRemoveMedia} provided={provided} /> )}
                                        </Draggable>
                                    ))}
                                    {provided.placeholder}
                                </div>
                            )}
                        </Droppable>
                    </DragDropContext>
                )}

                <div>
                    <label className="block text-gray-700 font-bold mb-2">Event Gallery YouTube Videos</label>
                    <div className="p-3 border rounded-lg">
                        <textarea
                            onPaste={(e) => handleMediaPaste(e, 'video')}
                            rows="3"
                            className="w-full p-2 border rounded-md disabled:bg-gray-100"
                            placeholder={ videoItems.length >= VIDEO_LIMIT ? `Maximum of ${VIDEO_LIMIT} videos reached.` : `Paste up to ${VIDEO_LIMIT - videoItems.length} YouTube links...` }
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
                                            {(provided) => ( <MediaPreview item={item} onRemove={handleRemoveMedia} provided={provided} /> )}
                                        </Draggable>
                                    ))}
                                    {provided.placeholder}
                                </div>
                            )}
                        </Droppable>
                    </DragDropContext>
                )}
                
                <div>
                    <label className="block text-gray-700 font-bold mb-2">Notification Classes (Max 3)</label>
                    <p className="text-sm text-gray-500 mb-2">This is used for Discord syncronization.</p>
                    <div className={`w-full p-3 border rounded-lg focus-within:ring-2 ${color.ring}`}>
                        <div className="flex flex-wrap gap-2 mb-2">
                            {eventClasses.map(c => (
                                <div key={c} className="flex items-center bg-gray-200 text-gray-800 text-sm font-medium px-2.5 py-1 rounded-full">
                                    <span>{c}</span>
                                    <button type="button" onClick={() => handleRemoveClass(c)} className="ml-2 text-gray-500 hover:text-gray-800">&times;</button>
                                </div>
                            ))}
                        </div>
                        <input
                            type="text"
                            value={classInput}
                            onChange={(e) => setClassInput(e.target.value)}
                            onKeyDown={handleClassKeyDown}
                            className="w-full bg-transparent focus:outline-none"
                            placeholder={eventClasses.length < 3 ? "Add a class..." : "Maximum of 3 classes reached"}
                            disabled={eventClasses.length >= 3}
                        />
                        {suggestedClasses.length > 0 && (
                            <div className="mt-2 pt-2 border-t flex flex-wrap gap-2">
                                {suggestedClasses.map(c => (
                                    <button key={c} type="button" onClick={() => handleAddClass(c)} className={`text-sm ${color.bg} ${color.hoverBg} text-white px-2.5 py-1 rounded-full transition-colors`}>
                                        {c}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                <RuleEditor rules={rules} setRules={setRules} />
                <CustomFieldsEditor fields={customFields} setCustomFields={setCustomFields} />

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-gray-700 font-bold mb-2">Submission Start Date & Time</label>
                        <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full p-3 border rounded-lg" required />
                    </div>
                    <div>
                        <label className="block text-gray-700 font-bold mb-2">Submission End Date & Time (Full Hours)</label>
                        <div className="flex gap-2">
                            <input type="date" value={endDatePart} onChange={(e) => setEndDatePart(e.target.value)} className="w-2/3 p-3 border rounded-lg" required />
                            <input type="time" value={endTimePart} onChange={(e) => handleEndTimeChange(e, setEndTimePart)} className="w-1/3 p-3 border rounded-lg" step="3600" required />
                        </div>
                    </div>
                </div>

                <div className="flex items-center space-x-4 bg-gray-100 p-3 rounded-lg">
                    <span className="text-gray-600">Separate Voting Time?</span>
                    <div className="relative w-14 h-8 flex items-center rounded-full cursor-pointer p-1 transition-colors duration-300"
                         onClick={() => setSeparateVoteTime(!separateVoteTime)}
                         style={{ backgroundColor: separateVoteTime ? '#34D399' : '#D1D5DB' }}
                    >
                        <div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${separateVoteTime ? 'translate-x-6' : 'translate-x-0'}`}></div>
                    </div>
                </div>

                {separateVoteTime && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-gray-700 font-bold mb-2">Voting Start Date & Time</label>
                            <input type="datetime-local" value={voteStartDate} onChange={(e) => setVoteStartDate(e.target.value)} className="w-full p-3 border rounded-lg" required min={startDate} />
                        </div>
                        <div>
                            <label className="block text-gray-700 font-bold mb-2">Voting End Date & Time (Full Hours)</label>
                            <div className="flex gap-2">
                                <input type="date" value={voteEndDatePart} onChange={(e) => setVoteEndDatePart(e.target.value)} className="w-2/3 p-3 border rounded-lg" required />
                                <input type="time" value={voteEndTimePart} onChange={(e) => handleEndTimeChange(e, setVoteEndTimePart)} className="w-1/3 p-3 border rounded-lg" step="3600" required />
                            </div>
                        </div>
                    </div>
                )}

                <div>
                    <label className="block text-gray-700 font-bold mb-2">Timezone</label>
                    <p className="text-sm text-gray-500 mb-2">Times are displayed in this timezone. Defaults to your browser's setting.</p>
                    <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full p-3 border rounded-lg bg-white">
                        {timezones.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                    </select>
                </div>

                <div>
                    <label className="block text-gray-700 font-bold mb-2">Submission & Voting Rules</label>
                    <div className="space-y-4 bg-gray-100 p-4 rounded-lg">
                        <div className="flex items-center justify-between">
                            <span className="text-gray-600">Allow multiple submissions per user?</span>
                            <div className="relative w-14 h-8 flex items-center rounded-full cursor-pointer p-1 transition-colors duration-300"
                                 onClick={() => setAllowMultipleSubmissions(!allowMultipleSubmissions)}
                                 style={{ backgroundColor: allowMultipleSubmissions ? '#34D399' : '#D1D5DB' }}
                            >
                                <div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${allowMultipleSubmissions ? 'translate-x-6' : 'translate-x-0'}`}></div>
                            </div>
                        </div>
                        {allowMultipleSubmissions && (
                            <div className="pl-6">
                                <label className="block text-sm font-semibold text-gray-600 mb-1">Max submissions per user:</label>
                                <input 
                                    type="number" 
                                    value={submissionLimit}
                                    onChange={(e) => setSubmissionLimit(e.target.value)}
                                    min="2"
                                    className="w-full p-2 border rounded-lg"
                                />
                            </div>
                        )}
                        <div className="flex items-center justify-between pt-4 border-t">
                            <span className="text-gray-600">Block creations made before a specific date?</span>
                            <div className="relative w-14 h-8 flex items-center rounded-full cursor-pointer p-1 transition-colors duration-300"
                                 onClick={() => setBlockOldCreations(!blockOldCreations)}
                                 style={{ backgroundColor: blockOldCreations ? '#34D399' : '#D1D5DB' }}
                            >
                                <div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${blockOldCreations ? 'translate-x-6' : 'translate-x-0'}`}></div>
                            </div>
                        </div>
                        {blockOldCreations && (
                             <div className="pl-6">
                                <label className="block text-sm font-semibold text-gray-600 mb-1">Creations must be made after:</label>
                                <input 
                                    type="date" 
                                    value={creationCutoffDate}
                                    onChange={(e) => setCreationCutoffDate(e.target.value)}
                                    className="w-full p-2 border rounded-lg"
                                />
                            </div>
                        )}
                        <div className="flex items-center justify-between pt-4 border-t">
                            <span className="text-gray-600">Voting Rule:</span>
                            <div className="flex items-center space-x-2">
                                <button
                                    type="button"
                                    onClick={() => setVoteType('multiple')}
                                    className={`px-3 py-1 text-sm rounded-full font-semibold ${voteType === 'multiple' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'}`}
                                >
                                    Vote for Multiple
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setVoteType('single')}
                                    className={`px-3 py-1 text-sm rounded-full font-semibold ${voteType === 'single' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'}`}
                                >
                                    Vote for One
                                </button>
                            </div>
                        </div>
                        {voteType === 'multiple' && (
                            <div className="pl-6">
                                <label className="block text-sm font-semibold text-gray-600 mb-1">Max votes per user:</label>
                                <input 
                                    type="number" 
                                    value={voteLimit}
                                    onChange={(e) => setVoteLimit(e.target.value)}
                                    min="1"
                                    className="w-full p-2 border rounded-lg"
                                />
                            </div>
                        )}
                    </div>
                </div>

                <div>
                    <label className="block text-gray-700 font-bold mb-2">Discord Reminders</label>
                    <div className="p-4 border rounded-lg bg-gray-50 space-y-3">
                        <p className="text-sm text-gray-600">Set up to 3 automated reminders to be posted in the event's Discord channel before it ends.</p>
                        <div className="space-y-4">
                            {[0, 1, 2].map(index => (
                                <div key={index} className="grid grid-cols-3 items-center gap-4">
                                    <label className="text-sm font-semibold text-gray-700">Reminder {index + 1}:</label>
                                    <select
                                        value={reminders[index] || 'none'}
                                        onChange={(e) => handleReminderChange(index, e.target.value)}
                                        className="col-span-2 w-full p-2 border rounded-lg bg-white"
                                    >
                                        {REMINDER_OPTIONS.map(opt => (
                                            <option
                                                key={opt.value}
                                                value={opt.value}
                                                disabled={opt.value !== 'none' && reminders.includes(opt.value) && reminders[index] !== opt.value}
                                            >
                                                {opt.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                {separateVoteTime && (
                    <div>
                        <label className="block text-gray-700 font-bold mb-2">Discord Voting Reminders</label>
                        <div className="p-4 border rounded-lg bg-gray-50 space-y-3">
                            <p className="text-sm text-gray-600">Set up to 3 automated reminders for the voting period.</p>
                            <div className="space-y-4">
                                {[0, 1, 2].map(index => (
                                    <div key={index} className="grid grid-cols-3 items-center gap-4">
                                        <label className="text-sm font-semibold text-gray-700">Voting Reminder {index + 1}:</label>
                                        <select
                                            value={voteReminders[index] || 'none'}
                                            onChange={(e) => handleVoteReminderChange(index, e.target.value)}
                                            className="col-span-2 w-full p-2 border rounded-lg bg-white"
                                        >
                                            {REMINDER_OPTIONS.map(opt => (
                                                <option
                                                    key={opt.value}
                                                    value={opt.value}
                                                    disabled={opt.value !== 'none' && voteReminders.includes(opt.value) && voteReminders[index] !== opt.value}
                                                >
                                                    {opt.label}
                                                </option>
                                            ))}
                                        </select>
                                    </div>
                                ))}
                            </div>
                        </div>
                    </div>
                )}

                <div>
                    <label className="block text-gray-700 font-bold mb-2">Visibility</label>
                    <div className="flex items-center space-x-4 bg-gray-100 p-3 rounded-lg">
                        <span className="text-gray-600">Invisible until event starts?</span>
                        <div className="relative w-14 h-8 flex items-center rounded-full cursor-pointer p-1 transition-colors duration-300"
                             onClick={() => setStatus(status === 'visible' ? 'invisible' : 'visible')}
                             style={{ backgroundColor: status === 'invisible' ? '#34D399' : '#D1D5DB' }}
                        >
                            <div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${status === 'invisible' ? 'translate-x-6' : 'translate-x-0'}`}></div>
                        </div>
                    </div>
                </div>

                <div className="flex space-x-4 pt-4">
                    <button type="submit" disabled={loading} className="w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50">
                        {loading ? 'Saving...' : (isEditing ? 'Save Changes' : 'Create Event')}
                    </button>
                    <button type="button" onClick={() => navigate(-1)} className="w-full bg-gray-500 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-lg">
                        Cancel
                    </button>
                </div>
            </form>
        </div>
    );
};

export default EventForm;