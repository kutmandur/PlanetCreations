import React, { useState, useEffect } from 'react';
import { db } from '../../firebase/config';
import { collection, query, onSnapshot, getDocs } from 'firebase/firestore';
import Spinner from '../ui/Spinner';
import EventCard from '../cards/EventCard';
import { isEventHidden } from '../../utils/helpers';

const AllEventsPage = ({ userProfile }) => {
    const [events, setEvents] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchEvents = async () => {
            // Alle Events laden und clientseitig filtern: 'invisible' gilt nur bis
            // zum Startzeitpunkt ("Invisible until event starts?"), ein reiner
            // status-Filter würde bereits gestartete Events dauerhaft ausblenden.
            const eventsQuery = query(collection(db, 'events'));

            const unsubscribe = onSnapshot(eventsQuery, async (snapshot) => {
                const eventsData = snapshot.docs
                    .map(doc => ({ id: doc.id, ...doc.data() }))
                    .filter(event => !isEventHidden(event));

                // To style the event cards, we need the theme color from each community.
                // It's more efficient to fetch all communities once.
                const communitiesSnapshot = await getDocs(collection(db, 'communitys'));
                const communitiesMap = new Map(communitiesSnapshot.docs.map(doc => [doc.id, doc.data()]));

                const eventsWithCommunityData = eventsData.map(event => ({
                    ...event,
                    community: communitiesMap.get(event.communityId)
                }));

                setEvents(eventsWithCommunityData);
                setLoading(false);
            });
            
            return () => unsubscribe();
        };

        fetchEvents();
    }, []);

    const now = new Date();
    const activeEvents = events
        .filter(event => event.endDate.toDate() > now)
        .sort((a, b) => a.startDate.toDate() - b.startDate.toDate());

    const pastEvents = events
        .filter(event => event.endDate.toDate() <= now)
        .sort((a, b) => b.endDate.toDate() - a.endDate.toDate());

    if (loading) {
        return <Spinner />;
    }

    return (
        <div>
            {activeEvents.length > 0 && (
                <div className="mb-12">
                    <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Active Events</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                        {activeEvents.map(event => (
                            <EventCard key={event.id} event={event} community={event.community} userProfile={userProfile} />
                        ))}
                    </div>
                </div>
            )}

            {pastEvents.length > 0 && (
                <div>
                    <h2 className="text-3xl font-bold text-gray-800 mb-6 text-center">Past Events</h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                        {pastEvents.map(event => (
                            <EventCard key={event.id} event={event} community={event.community} userProfile={userProfile} />
                        ))}
                    </div>
                </div>
            )}

            {events.length === 0 && (
                 <div className="text-center text-gray-500 mt-10 py-10 bg-white rounded-lg shadow-md">
                    <h2 className="text-3xl font-bold text-gray-800">No Events Found</h2>
                    <p className="mt-4 max-w-2xl mx-auto">
                        There are currently no active or past events. Check back soon!
                    </p>
                </div>
            )}
        </div>
    );
};

export default AllEventsPage;
