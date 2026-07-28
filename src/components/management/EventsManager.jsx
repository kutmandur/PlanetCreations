import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../../firebase/config';
import { collection, query, where, orderBy, getDocs } from 'firebase/firestore';
import EventCard from '../cards/EventCard';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

// Community-Manager-Tab "Events": Events erstellen/bearbeiten/verwalten.
// Zeigt ALLE Events der Community (auch unsichtbare) — der öffentliche
// Events-Tab auf der Community-Seite ist dafür für Owner und Nutzer identisch.
const EventsManager = ({ community, userProfile, setModalMessage, canCreateEvents = true }) => {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let mounted = true;
        const fetchEvents = async () => {
            try {
                const eventsQuery = query(
                    collection(db, 'events'),
                    where('communityId', '==', community.id),
                    orderBy('startDate', 'desc')
                );
                const snap = await getDocs(eventsQuery);
                if (mounted) setEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
            } catch (error) {
                console.error('Failed to load events:', error);
                if (mounted) setModalMessage(`Error loading events: ${error.message}`);
            } finally {
                if (mounted) setLoading(false);
            }
        };
        fetchEvents();
        return () => { mounted = false; };
    }, [community.id, setModalMessage]);

    if (loading) {
        return <div className="flex justify-center py-16"><Spinner /></div>;
    }

    return (
        <div>
            {canCreateEvents && <div className="text-center mb-8">
                <Link to={`/community/${community.id}/create-event`} state={{ communityName: community.name }}>
                    <button className="community-bg hover:brightness-90 text-white font-bold py-2 px-6 rounded-lg">
                        Create New Event
                    </button>
                </Link>
            </div>}

            {events.length === 0 ? (
                <div className="text-center text-gray-500 py-10 bg-gray-50 rounded-lg border max-w-3xl mx-auto">
                    <h3 className="text-xl font-bold">No Events Yet</h3>
                    <p className="mt-2">
                        {canCreateEvents
                            ? "Create your community's first event above."
                            : 'There are no community events to manage yet.'}
                    </p>
                </div>
            ) : (
                <div className="grid gap-6 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                    {events.map(event => (
                        <div key={event.id} className="flex flex-col h-full">
                            <div className="flex-grow">
                                <EventCard event={event} community={community} userProfile={userProfile} showStatus={true} />
                            </div>
                            <div className="flex gap-2 mt-2">
                                <Link to={`/event/${event.id}/edit`} className="flex-1">
                                    <button className="w-full flex items-center justify-center gap-1 text-sm font-semibold py-2 px-3 rounded-lg bg-yellow-500 hover:bg-yellow-600 text-white">
                                        <Icon path={ICONS.edit} className="w-4 h-4" /> Edit
                                    </button>
                                </Link>
                                <Link to={`/event/${event.id}/manage`} className="flex-1">
                                    <button className="w-full flex items-center justify-center gap-1 text-sm font-semibold py-2 px-3 rounded-lg bg-purple-600 hover:bg-purple-700 text-white">
                                        <Icon path={ICONS.cog} className="w-4 h-4" /> Manage
                                    </button>
                                </Link>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

export default EventsManager;
