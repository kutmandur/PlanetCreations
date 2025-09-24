import React, { useState, useEffect } from 'react';
import { db } from '../../firebase/config';
import { collection, query, where, getDocs } from 'firebase/firestore';
import CommunityCard from '../cards/CommunityCard';
import Spinner from './Spinner';

const CommunitySuggestions = ({ userProfile, myCommunityIds, refreshTrigger }) => {
    const [suggestions, setSuggestions] = useState([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        const fetchSuggestions = async () => {
            setLoading(true);
            if (!userProfile?.discordGuilds || userProfile.discordGuilds.length === 0) {
                setLoading(false);
                return;
            }

            try {
                // 1. Get all communities on the platform that have a Discord server linked
                const communitiesWithDiscordQuery = query(
                    collection(db, 'communitys'),
                    where('discordServerId', '!=', null)
                );
                const querySnapshot = await getDocs(communitiesWithDiscordQuery);
                const allPlatformCommunities = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

                // 2. Filter to find matches
                const suggestedCommunities = allPlatformCommunities.filter(community => {
                    const userIsInDiscord = userProfile.discordGuilds.includes(community.discordServerId);
                    const userIsNotMember = !myCommunityIds.includes(community.id);
                    return userIsInDiscord && userIsNotMember;
                });

                setSuggestions(suggestedCommunities);
            } catch (error) {
                console.error("Error fetching community suggestions:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchSuggestions();
    }, [userProfile, myCommunityIds, refreshTrigger]);

    if (loading) {
        return <div className="text-center p-4"><Spinner size="medium" /></div>;
    }

    if (suggestions.length === 0) {
        return (
            <div className="text-center text-gray-500 mb-8 p-4 bg-white rounded-lg shadow-sm">
                No new community suggestions found based on your Discord servers.
            </div>
        );
    }

    return (
        <div className="mb-12">
            <h2 className="text-2xl font-bold mb-4 text-gray-800 text-center">Suggestions Based on Your Discord Servers</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
                {suggestions.map(community => (
                    <CommunityCard key={community.id} community={community} />
                ))}
            </div>
        </div>
    );
};

export default CommunitySuggestions;