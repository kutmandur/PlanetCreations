import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { db } from '../../firebase/config';
import { doc, getDoc, setDoc, addDoc, collection, serverTimestamp, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import { getGameColor, containsBlacklistedWord, ICONS } from '../../utils/helpers';
import { getDefaultGameId } from '../../utils/gamesRegistry';
import useGames from '../../hooks/useGames';

// Import all sub-components from their new location
import EventGameSelector from '../eventform/EventGameSelector';
import EventDetails from '../eventform/EventDetails';
import EventGalleries from '../eventform/EventGalleries';
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
    const [activeCategory, setActiveCategory] = useState('details');
    const [mobileOpen, setMobileOpen] = useState(false);
    const [communityName, setCommunityName] = useState('');
    const [game, setGame] = useState(getDefaultGameId());
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
    const [discordChannels, setDiscordChannels] = useState([]);
    const [notificationMode, setNotificationMode] = useState('none');
    const [discordNotificationChannelId, setDiscordNotificationChannelId] = useState('');
    const [discordSubmissionChannelId, setDiscordSubmissionChannelId] = useState('');
    const [voteType, setVoteType] = useState('single');
    const [voteLimit, setVoteLimit] = useState(1);
    const [votingEnabled, setVotingEnabled] = useState(true);
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
    const TABS = useGames();

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
                    setGame(data.game || getDefaultGameId());
                    setVoteType(data.voteType || 'single');
                    setVoteLimit(data.voteLimit || 1);
                    setVotingEnabled(data.votingEnabled !== false);
                    setNotificationMode(data.notificationMode || 'none');
                    setDiscordNotificationChannelId(data.discordNotificationChannelId || '');
                    setDiscordSubmissionChannelId(data.discordSubmissionChannelId || '');
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
                        const channels = communitySnap.data().discordChannels || [];
                        setDiscordChannels(channels);
                        const hasChannels = channels.length > 0;
                        if (!isEditing) {
                            // Neues Event: sinnvoller Default je nach Discord-Anbindung.
                            setNotificationMode(hasChannels ? 'both' : 'site');
                        } else if (!hasChannels) {
                            // Bearbeiten ohne verbundenen Bot: Discord-Modi herunterstufen,
                            // damit keine unwählbare Option aktiv bleibt.
                            setNotificationMode(prev => (prev === 'both' ? 'site' : prev === 'discord' ? 'none' : prev));
                        }
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
        if (loading || activeCategory !== 'details') return;
        // Der Game-Selector wird erst gemountet, wenn die "Details"-Kategorie aktiv ist —
        // kurz warten, damit die Tab-Refs gemessen werden können.
        const t = setTimeout(() => {
            const activeTabIndex = TABS.findIndex(tab => tab.id === game);
            const activeTabNode = tabRefs.current[activeTabIndex];
            if (activeTabNode && gliderRef.current) {
                gliderRef.current.style.left = `${activeTabNode.offsetLeft}px`;
                gliderRef.current.style.width = `${activeTabNode.offsetWidth}px`;
            }
        }, 50);
        return () => clearTimeout(t);
    }, [game, TABS, loading, activeCategory]);

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

        // Nur von der letzten Kategorie aus absenden (verhindert versehentliches
        // Submit per Enter auf einer früheren Wizard-Seite).
        if (activeCategory !== 'visibility') return;

        // Pflichtfelder auf ihren Kategorie-Seiten prüfen (native required greift nicht
        // über die nicht gemounteten Seiten hinweg).
        if (!title.trim()) {
            setModalMessage('Please enter an event title.');
            goToCategory('details');
            return;
        }
        if (!endDatePart) {
            setModalMessage('Please set an end date for the event.');
            goToCategory('schedule');
            return;
        }

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
            creatorId: user.uid, updatedAt: serverTimestamp(),
            reminders: finalReminders, voteReminders: (separateVoteTime && votingEnabled) ? finalVoteReminders : [],
            voteType, voteLimit: voteType === 'multiple' ? Number(voteLimit) : 1,
            votingEnabled,
            notificationMode,
            discordNotificationChannelId: (notificationMode === 'both' || notificationMode === 'discord') ? (discordNotificationChannelId || null) : null,
            discordSubmissionChannelId: discordSubmissionChannelId || null,
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

    const CATEGORIES = [
        { id: 'details', label: 'Details', icon: ICONS.pencil },
        { id: 'media', label: 'Media', icon: ICONS.image },
        { id: 'rules', label: 'Rules & Fields', icon: ICONS.checklist },
        { id: 'submissions', label: 'Submissions & Voting', icon: ICONS.users },
        { id: 'schedule', label: 'Schedule', icon: ICONS.clock },
        { id: 'notifications', label: 'Notifications', icon: ICONS.bell },
        { id: 'visibility', label: 'Visibility & Results', icon: ICONS.eye },
    ];
    const activeIndex = CATEGORIES.findIndex(c => c.id === activeCategory);
    const isLast = activeIndex === CATEGORIES.length - 1;
    const activeCategoryLabel = CATEGORIES[activeIndex]?.label || '';

    const goToCategory = (id) => {
        setActiveCategory(id);
        setMobileOpen(true);
        if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' });
    };
    const goNext = () => {
        const next = CATEGORIES[activeIndex + 1];
        if (next) goToCategory(next.id);
    };

    const renderCategory = () => {
        switch (activeCategory) {
            case 'details':
                return (<>
                    <EventGameSelector game={game} setGame={setGame} TABS={TABS} tabRefs={tabRefs} gliderRef={gliderRef} color={color} />
                    <EventDetails title={title} setTitle={setTitle} bannerImageUrl={bannerImageUrl} setBannerImageUrl={setBannerImageUrl} description={description} setDescription={setDescription} />
                </>);
            case 'media':
                return <EventGalleries imageItems={imageItems} videoItems={videoItems} handleMediaPaste={handleMediaPaste} handleMediaDragEnd={handleMediaDragEnd} handleRemoveMedia={handleRemoveMedia} IMAGE_LIMIT={IMAGE_LIMIT} VIDEO_LIMIT={VIDEO_LIMIT} />;
            case 'rules':
                return (<>
                    <RuleEditor rules={rules} setRules={setRules} />
                    <CustomFieldsEditor fields={customFields} setCustomFields={setCustomFields} />
                </>);
            case 'submissions':
                return <EventSubmissionRules
                    allowMultipleSubmissions={allowMultipleSubmissions} setAllowMultipleSubmissions={setAllowMultipleSubmissions}
                    submissionLimit={submissionLimit} setSubmissionLimit={setSubmissionLimit}
                    blockOldCreations={blockOldCreations} setBlockOldCreations={setBlockOldCreations}
                    creationCutoffDate={creationCutoffDate} setCreationCutoffDate={setCreationCutoffDate}
                    voteType={voteType} setVoteType={setVoteType}
                    voteLimit={voteLimit} setVoteLimit={setVoteLimit}
                    votingEnabled={votingEnabled} setVotingEnabled={setVotingEnabled}
                />;
            case 'schedule':
                return <EventTimeSettings
                    startDate={startDate} setStartDate={setStartDate}
                    endDatePart={endDatePart} setEndDatePart={setEndDatePart}
                    endTimePart={endTimePart} setEndTimePart={setEndTimePart}
                    separateVoteTime={separateVoteTime} setSeparateVoteTime={setSeparateVoteTime}
                    voteStartDate={voteStartDate} setVoteStartDate={setVoteStartDate}
                    voteEndDatePart={voteEndDatePart} setVoteEndDatePart={setVoteEndDatePart}
                    voteEndTimePart={voteEndTimePart} setVoteEndTimePart={setVoteEndTimePart}
                    handleEndTimeChange={handleEndTimeChange}
                    timezone={timezone} setTimezone={setTimezone} timezones={timezones}
                />;
            case 'notifications':
                return <EventDiscordSettings
                    discordChannels={discordChannels}
                    notificationMode={notificationMode}
                    setNotificationMode={setNotificationMode}
                    discordNotificationChannelId={discordNotificationChannelId}
                    setDiscordNotificationChannelId={setDiscordNotificationChannelId}
                    discordSubmissionChannelId={discordSubmissionChannelId}
                    setDiscordSubmissionChannelId={setDiscordSubmissionChannelId}
                    reminders={reminders}
                    voteReminders={voteReminders}
                    handleReminderChange={handleReminderChange}
                    separateVoteTime={separateVoteTime}
                    votingEnabled={votingEnabled}
                    notificationTemplates={notificationTemplates}
                    setNotificationTemplates={setNotificationTemplates}
                    getMessageSuggestions={getMessageSuggestions}
                />;
            case 'visibility':
                return (<>
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
                </>);
            default:
                return null;
        }
    };

    if (loading) return <div className="h-screen flex justify-center items-center"><Spinner /></div>;

    return (
        <div className="max-w-5xl mx-auto mt-10 px-4" style={color.style}>
            <div className="text-center mb-6">
                <h1 className="text-3xl font-bold">{isEditing ? 'Edit Event' : 'Create New Event'}</h1>
                {communityName && (<div className="text-gray-500">for <span className="font-bold" style={{ color: color.hex }}>{communityName}</span></div>)}
            </div>

            <form onSubmit={handleSubmit}>
                <div className="lg:flex lg:gap-6 lg:items-start">
                    {/* Category list — sidebar on desktop, first screen on mobile */}
                    <nav className={`${mobileOpen ? 'hidden' : 'block'} lg:block lg:w-64 lg:flex-shrink-0`}>
                        <div className="bg-white rounded-2xl shadow-md p-2">
                            {CATEGORIES.map((cat, i) => {
                                const active = cat.id === activeCategory;
                                return (
                                    <button
                                        key={cat.id}
                                        type="button"
                                        onClick={() => goToCategory(cat.id)}
                                        style={active ? { backgroundColor: color.hex, color: '#fff' } : {}}
                                        className={`w-full flex items-center gap-3 p-2.5 rounded-xl text-left mb-1 last:mb-0 transition-colors ${active ? '' : 'hover:bg-gray-100 text-gray-800'}`}
                                    >
                                        <span className={`w-7 h-7 flex-shrink-0 flex items-center justify-center rounded-lg text-xs font-bold ${active ? 'bg-white/20' : 'bg-gray-100 text-gray-500'}`}>
                                            {i + 1}
                                        </span>
                                        <span className="flex-grow min-w-0 font-semibold text-sm truncate">{cat.label}</span>
                                        <Icon path={ICONS.chevronRight} className={`w-4 h-4 flex-shrink-0 lg:hidden ${active ? 'text-white' : 'text-gray-300'}`} />
                                    </button>
                                );
                            })}
                        </div>
                    </nav>

                    {/* Detail pane — right column on desktop, drilled-in screen on mobile */}
                    <section className={`${mobileOpen ? 'block' : 'hidden'} lg:block flex-1 min-w-0 mt-4 lg:mt-0`}>
                        <button
                            type="button"
                            onClick={() => setMobileOpen(false)}
                            className="lg:hidden flex items-center gap-1 font-semibold mb-3"
                            style={{ color: color.hex }}
                        >
                            <Icon path={ICONS.chevronLeft} className="w-5 h-5" />
                            All sections
                        </button>

                        <div className="bg-white rounded-2xl shadow-md p-6 sm:p-8 space-y-6">
                            <div className="flex items-center justify-between">
                                <h2 className="text-2xl font-bold text-gray-800">{activeCategoryLabel}</h2>
                                <span className="text-sm text-gray-400">{activeIndex + 1} / {CATEGORIES.length}</span>
                            </div>

                            {renderCategory()}

                            <div className="flex justify-between items-center gap-4 pt-6 border-t">
                                <button
                                    type="button"
                                    onClick={() => navigate(-1)}
                                    className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2.5 px-5 rounded-xl"
                                >
                                    Cancel
                                </button>
                                {isLast ? (
                                    <button
                                        type="submit"
                                        disabled={loading}
                                        style={{ backgroundColor: color.hex }}
                                        className="text-white font-bold py-2.5 px-6 rounded-xl disabled:opacity-50 hover:brightness-95"
                                    >
                                        {loading ? 'Saving...' : (isEditing ? 'Save Changes' : 'Create Event')}
                                    </button>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={goNext}
                                        style={{ backgroundColor: color.hex }}
                                        className="text-white font-bold py-2.5 px-6 rounded-xl hover:brightness-95 flex items-center gap-2"
                                    >
                                        Next
                                        <Icon path={ICONS.chevronRight} className="w-5 h-5" />
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

export default EventForm;