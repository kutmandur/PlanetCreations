import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../../firebase/config';
import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp, updateDoc, arrayUnion, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import Spinner from '../ui/Spinner';
import { getGameColor, containsBlacklistedWord } from '../../utils/helpers';

// Import all sub-components from their new location
import EventGameSelector from '../eventform/EventGameSelector';
import EventDetails from '../eventform/EventDetails';
import EventGalleries from '../eventform/EventGalleries';
import EventClassSelector from '../eventform/EventClassSelector';
import RuleEditor from '../eventform/RuleEditor';
import CustomFieldsEditor from '../eventform/CustomFieldsEditor';
import EventTimeSettings from '../eventform/EventTimeSettings';
import EventSubmissionRules from '../eventform/EventSubmissionRules';
import EventDiscordSettings from '../eventform/EventDiscordSettings';
import EventVisibility from '../eventform/EventVisibility';

const defaultReminder = { days: 0, hours: 0, minutes: 0 };

const EventForm = ({ user, setModalMessage, blacklist = [] }) => {
    const { eventId, communityId } = useParams();
    const navigate = useNavigate();
    const isEditing = !!eventId;

    // --- ALL STATE LIVES IN THE PARENT COMPONENT ---
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
    const [endTimePart, setEndTimePart] = useState('23:59');
    const [separateVoteTime, setSeparateVoteTime] = useState(false);
    const [voteStartDate, setVoteStartDate] = useState('');
    const [voteEndDatePart, setVoteEndDatePart] = useState('');
    const [voteEndTimePart, setVoteEndTimePart] = useState('23:59');
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
    const [voteType, setVoteType] = useState('single');
    const [voteLimit, setVoteLimit] = useState(1);
    const [votingEnabled, setVotingEnabled] = useState(true);
    const [reminderChannels, setReminderChannels] = useState('both');
    const [autoPostSubmissions, setAutoPostSubmissions] = useState(false);
    const [publishResultsImmediately, setPublishResultsImmediately] = useState(false);
    const [imageItems, setImageItems] = useState([]);
    const [videoItems, setVideoItems] = useState([]);
    const IMAGE_LIMIT = 10;
    const VIDEO_LIMIT = 3;
    const [reminders, setReminders] = useState([defaultReminder, defaultReminder, defaultReminder]);
    const [voteReminders, setVoteReminders] = useState([defaultReminder, defaultReminder, defaultReminder]);
    const [previousEvents, setPreviousEvents] = useState([]);
    const [notificationTemplates, setNotificationTemplates] = useState({
        eventStart: '', submissionReminder: '', submissionEnd: '',
        votingReminder: '', votingEnd: '',
    });

    const timezones = Intl.supportedValuesOf('timeZone');
    const color = getGameColor(game);
    const tabRefs = useRef([]);
    const gliderRef = useRef(null);
    const TABS = useRef([
        { id: 'planet-coaster', name: 'Planet Coaster' },
        { id: 'planet-coaster-2', name: 'Planet Coaster 2' },
        { id: 'planet-zoo', name: 'Planet Zoo' },
    ]).current;

    // --- ALL LOGIC & HANDLERS LIVE IN THE PARENT COMPONENT ---
    const parseReminderString = useCallback((str) => {
        if (!str || str === 'none' || str.length < 2) return { days: 0, hours: 0, minutes: 0 };
        const unit = str.slice(-1);
        let totalMinutes = parseInt(str.slice(0, -1), 10);
        if (isNaN(totalMinutes)) return { days: 0, hours: 0, minutes: 0 };

        if (unit === 'h') totalMinutes *= 60;
        if (unit === 'd') totalMinutes *= 1440;

        const days = Math.floor(totalMinutes / 1440);
        const hours = Math.floor((totalMinutes % 1440) / 60);
        const minutes = totalMinutes % 60;
        
        return { days, hours, minutes };
    }, []);
    
    const formatDateForLocalInput = useCallback((date = new Date()) => {
        const offset = date.getTimezoneOffset() * 60000;
        const localDate = new Date(date.getTime() - offset);
        return localDate.toISOString().slice(0, 16);
    }, []);

    const formatDateForInput = useCallback((date, tz) => {
        try {
            const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false, timeZone: tz }).formatToParts(date);
            const partMap = parts.reduce((acc, part) => { acc[part.type] = part.value; return acc; }, {});
            return `${partMap.year}-${partMap.month}-${partMap.day}T${partMap.hour}:${partMap.minute}`;
        } catch (e) { return formatDateForLocalInput(date); }
    }, [formatDateForLocalInput]);

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
                    setVotingEnabled(data.votingEnabled !== false);
                    setReminderChannels(data.reminderChannels || 'both');
                    setAutoPostSubmissions(data.autoPostSubmissions === true);
                    if (data.notificationTemplates) setNotificationTemplates(data.notificationTemplates);
                    
                    const loadedReminders = (data.reminders || []).map(parseReminderString);
                    while (loadedReminders.length < 3) { loadedReminders.push(defaultReminder); }
                    setReminders(loadedReminders.slice(0, 3));

                    const loadedVoteReminders = (data.voteReminders || []).map(parseReminderString);
                    while (loadedVoteReminders.length < 3) { loadedVoteReminders.push(defaultReminder); }
                    setVoteReminders(loadedVoteReminders.slice(0, 3));

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
                    if (data.voteStartDate) setVoteStartDate(formatDateForInput(data.voteStartDate.toDate(), eventTimezone));
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
                    const prevEventsQuery = query(collection(db, 'events'), where('communityId', '==', effectiveCommunityId), orderBy('createdAt', 'desc'), limit(5));
                    const prevEventsSnap = await getDocs(prevEventsQuery);
                    setPreviousEvents(prevEventsSnap.docs.map(doc => doc.data()));
                }
            } catch (error) { setModalMessage("Failed to load form data: " + error.message); } 
            finally { setLoading(false); }
        };
        loadFormData();
    }, [eventId, communityId, isEditing, navigate, setModalMessage, formatDateForInput, formatDateForLocalInput, parseReminderString]);
    
    useEffect(() => {
        if (isEditing && originalEventDates && timezone) {
            const { start, end } = originalEventDates;
            setStartDate(formatDateForInput(start, timezone));
            const endString = formatDateForInput(end, timezone);
            setEndDatePart(endString.split('T')[0]);
            setEndTimePart(endString.split('T')[1]);
        }
    }, [timezone, isEditing, originalEventDates, formatDateForInput]);

    useEffect(() => {
        const currentSelected = eventClasses.map(c => c.toLowerCase());
        if (classInput.trim() === '') {
            setSuggestedClasses(allCommunityClasses.filter(c => !currentSelected.includes(c.toLowerCase())).slice(0, 5));
        } else {
            const lowerClassInput = classInput.toLowerCase();
            setSuggestedClasses(allCommunityClasses.filter(c => c.toLowerCase().includes(lowerClassInput) && !currentSelected.includes(c.toLowerCase())).slice(0, 5));
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
    const handleRemoveClass = (classToRemove) => setEventClasses(eventClasses.filter(c => c !== classToRemove));
    const handleClassKeyDown = (e) => {
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); handleAddClass(classInput); }
    };
    const handleEndTimeChange = (e, setTimePart) => setTimePart(e.target.value);
    const handleReminderChange = (index, part, value, isVoteReminder = false) => {
        const updater = isVoteReminder ? setVoteReminders : setReminders;
        updater(prev => {
            const newReminders = [...prev];
            const val = Math.max(0, parseInt(value, 10) || 0);
            newReminders[index] = { ...newReminders[index], [part]: val };
            return newReminders;
        });
    };
    const getMessageSuggestions = (templateKey) => {
        const messages = previousEvents.map(event => event.notificationTemplates?.[templateKey]).filter(Boolean);
        return [...new Set(messages)];
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
        linksToAdd.forEach(link => {
            if(currentItems.some(item => item.url === link)) return;
            newMedia.push({ id: `${mediaType}-${Date.now()}-${Math.random()}`, type: mediaType, url: link });
        });
        if (mediaType === 'image') setImageItems(prev => [...prev, ...newMedia]);
        else setVideoItems(prev => [...prev, ...newMedia]);
        if (links.slice(availableSlots).length > 0) {
            setModalMessage(`You can only add ${limit} ${mediaType}s. ${links.slice(availableSlots).length} link(s) were not added.`);
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

        // Blacklist validation
        const textsToCheck = [
            title,
            description,
            ...rules.map(r => (r && typeof r === 'object') ? r.text : r),
            ...customFields.map(f => f.label)
        ];
        for (const text of textsToCheck) {
            if (containsBlacklistedWord(text, blacklist)) {
                setModalMessage('Your event contains a forbidden word. Please revise it.');
                return;
            }
        }

        setLoading(true);
        const formatReminder = (reminder) => {
            const totalMinutes = (reminder.days * 1440) + (reminder.hours * 60) + reminder.minutes;
            return totalMinutes > 0 ? `${totalMinutes}m` : '';
        };
        const finalReminders = reminders.map(formatReminder).filter(Boolean);
        const finalVoteReminders = voteReminders.map(formatReminder).filter(Boolean);
        const finalEndDate = `${endDatePart}T${endTimePart}`;
        const finalVoteEndDate = separateVoteTime ? `${voteEndDatePart}T${voteEndTimePart}` : finalEndDate;
        const finalVoteStartDate = separateVoteTime ? new Date(voteStartDate) : new Date(startDate);
        const finalImageUrls = imageItems.map(item => item.url);
        const finalVideoUrls = videoItems.map(item => item.url);
        const eventData = {
            title, description, rules,
            imageUrls: finalImageUrls, videoUrls: finalVideoUrls, bannerImageUrl,
            startDate: new Date(startDate), endDate: new Date(finalEndDate),
            separateVoteTime, voteStartDate: finalVoteStartDate, voteEndDate: new Date(finalVoteEndDate),
            timezone, status, customFields, allowMultipleSubmissions,
            submissionLimit: allowMultipleSubmissions ? Number(submissionLimit) : 1,
            blockOldCreations, creationCutoffDate: blockOldCreations ? new Date(creationCutoffDate) : null,
            game, communityId: isEditing ? (await getDoc(doc(db, 'events', eventId))).data().communityId : communityId,
            creatorId: user.uid, updatedAt: serverTimestamp(), classes: eventClasses,
            reminders: finalReminders, voteReminders: (separateVoteTime && votingEnabled) ? finalVoteReminders : [],
            voteType, voteLimit: voteType === 'multiple' ? Number(voteLimit) : 1,
            votingEnabled, reminderChannels, autoPostSubmissions,
            notificationsSent: isEditing ? (await getDoc(doc(db, 'events', eventId))).data().notificationsSent || {} : {},
            notificationTemplates,
        };
        // Nach Ablauf geht das Event in die "Managing Phase" (Ergebnisse werden erst
        // nach manuellem Publish angezeigt) — außer der Veranstalter wählt beim
        // Erstellen direktes Publishing. Bereits veröffentlichte Events behalten
        // ihren Status.
        if (!isEditing) {
            eventData.resultsStatus = publishResultsImmediately ? 'published' : 'managing';
        }
        try {
            const newClasses = eventClasses.filter(c => !allCommunityClasses.some(ac => ac.toLowerCase() === c.toLowerCase()));
            if (newClasses.length > 0) {
                await updateDoc(doc(db, 'communitys', eventData.communityId), { eventClasses: arrayUnion(...newClasses) });
            }
            if (isEditing) {
                const eventRef = doc(db, 'events', eventId);
                await setDoc(eventRef, { ...eventData, createdAt: (await getDoc(eventRef)).data()?.createdAt || serverTimestamp() }, { merge: true });
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
            {communityName && (<div className="text-center mb-6 text-gray-500">for <span className="font-bold" style={{ color: color.text }}>{communityName}</span></div>)}
            
            <form onSubmit={handleSubmit} className="space-y-6">
                <EventGameSelector game={game} setGame={setGame} TABS={TABS} tabRefs={tabRefs} gliderRef={gliderRef} color={color} />
                <EventDetails title={title} setTitle={setTitle} bannerImageUrl={bannerImageUrl} setBannerImageUrl={setBannerImageUrl} description={description} setDescription={setDescription} />
                <EventGalleries imageItems={imageItems} videoItems={videoItems} handleMediaPaste={handleMediaPaste} handleMediaDragEnd={handleMediaDragEnd} handleRemoveMedia={handleRemoveMedia} IMAGE_LIMIT={IMAGE_LIMIT} VIDEO_LIMIT={VIDEO_LIMIT} />
                <EventClassSelector eventClasses={eventClasses} classInput={classInput} setClassInput={setClassInput} suggestedClasses={suggestedClasses} handleAddClass={handleAddClass} handleRemoveClass={handleRemoveClass} handleClassKeyDown={handleClassKeyDown} color={color} />
                <RuleEditor rules={rules} setRules={setRules} />
                <CustomFieldsEditor fields={customFields} setCustomFields={setCustomFields} />
                
                <EventSubmissionRules
                    allowMultipleSubmissions={allowMultipleSubmissions} setAllowMultipleSubmissions={setAllowMultipleSubmissions}
                    submissionLimit={submissionLimit} setSubmissionLimit={setSubmissionLimit}
                    blockOldCreations={blockOldCreations} setBlockOldCreations={setBlockOldCreations}
                    creationCutoffDate={creationCutoffDate} setCreationCutoffDate={setCreationCutoffDate}
                    voteType={voteType} setVoteType={setVoteType}
                    voteLimit={voteLimit} setVoteLimit={setVoteLimit}
                    votingEnabled={votingEnabled} setVotingEnabled={setVotingEnabled}
                />
                
                <EventTimeSettings
                    startDate={startDate} setStartDate={setStartDate}
                    endDatePart={endDatePart} setEndDatePart={setEndDatePart}
                    endTimePart={endTimePart} setEndTimePart={setEndTimePart}
                    separateVoteTime={separateVoteTime} setSeparateVoteTime={setSeparateVoteTime}
                    voteStartDate={voteStartDate} setVoteStartDate={setVoteStartDate}
                    voteEndDatePart={voteEndDatePart} setVoteEndDatePart={setVoteEndDatePart}
                    voteEndTimePart={voteEndTimePart} setVoteEndTimePart={setVoteEndTimePart}
                    handleEndTimeChange={handleEndTimeChange}
                    timezone={timezone} setTimezone={setTimezone} timezones={timezones}
                />
                
                <EventDiscordSettings
                    reminders={reminders}
                    voteReminders={voteReminders}
                    handleReminderChange={handleReminderChange}
                    separateVoteTime={separateVoteTime}
                    votingEnabled={votingEnabled}
                    reminderChannels={reminderChannels}
                    setReminderChannels={setReminderChannels}
                    autoPostSubmissions={autoPostSubmissions}
                    setAutoPostSubmissions={setAutoPostSubmissions}
                    notificationTemplates={notificationTemplates}
                    setNotificationTemplates={setNotificationTemplates}
                    getMessageSuggestions={getMessageSuggestions}
                />

                <EventVisibility status={status} setStatus={setStatus} />

                {!isEditing && (
                    <div>
                        <label className="block text-gray-700 font-bold mb-2">Results</label>
                        <div className="flex items-center space-x-4 bg-gray-100 p-3 rounded-lg">
                            <span className="text-gray-600 flex-grow">Publish results immediately when the event ends?</span>
                            <div
                                className="relative w-14 h-8 flex items-center rounded-full cursor-pointer p-1 transition-colors duration-300 flex-shrink-0"
                                onClick={() => setPublishResultsImmediately(prev => !prev)}
                                style={{ backgroundColor: publishResultsImmediately ? '#34D399' : '#D1D5DB' }}
                            >
                                <div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${publishResultsImmediately ? 'translate-x-6' : 'translate-x-0'}`}></div>
                            </div>
                        </div>
                        <p className="text-xs text-gray-500 mt-1 px-1">
                            Off: the event enters a managing phase after it ends — you review, order and publish the results yourself (with optional video groups).
                        </p>
                    </div>
                )}

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