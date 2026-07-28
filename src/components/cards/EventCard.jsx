import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getEffectiveCommunityPermissions } from '../../utils/communityPermissions';

// showStatus: undefined = automatisch (Staff sieht Badge), true/false = erzwingen.
// Der öffentliche Community-Tab übergibt false (Owner-Ansicht = Nutzer-Ansicht),
// der Manager-Tab true.
const EventCard = ({ event, community, userProfile, showStatus }) => {
    const themeColor = community?.themeColor || '#F97316';
    const [countdown, setCountdown] = useState('');

    useEffect(() => {
        const calculateCountdown = () => {
            const now = new Date();
            const startDate = event.startDate?.toDate();
            const endDate = event.endDate?.toDate();
            const voteEndDate = event.voteEndDate?.toDate();

            if (!startDate || !endDate) {
                setCountdown('Date TBD');
                return;
            }

            const formatDiff = (diff) => {
                const days = Math.floor(diff / (1000 * 60 * 60 * 24));
                const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
                const minutes = Math.floor((diff / 1000 / 60) % 60);
                return `${days}d ${hours}h ${minutes}m`;
            };

            if (now < startDate) {
                setCountdown(`Starts in: ${formatDiff(startDate - now)}`);
            } else if (now >= startDate && now <= endDate) {
                setCountdown(`Ends in: ${formatDiff(endDate - now)}`);
            } else if (voteEndDate && now < voteEndDate) {
                setCountdown(`Voting ends in: ${formatDiff(voteEndDate - now)}`);
            } else {
                setCountdown('Event Ended');
            }
        };

        calculateCountdown();
        const interval = setInterval(calculateCountdown, 60000); // Update every minute

        return () => clearInterval(interval);
    }, [event.startDate, event.endDate, event.voteEndDate]);

    const hexToRgba = (hex, alpha = 0.1) => {
        if (!hex) return `rgba(249, 250, 251, 1)`; // default light gray
        try {
            const shorthandRegex = /^#?([a-f\d])([a-f\d])([a-f\d])$/i;
            hex = hex.replace(shorthandRegex, (m, r, g, b) => r + r + g + g + b + b);

            const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
            const [r, g, b] = result ? [parseInt(result[1], 16), parseInt(result[2], 16), parseInt(result[3], 16)] : [0,0,0];
            return `rgba(${r},${g},${b},${alpha})`;
        } catch (e) {
            return `rgba(249, 250, 251, 1)`;
        }
    };

    const isSiteStaff = userProfile && ['admin', 'moderator'].includes(userProfile.role);
    
    const currentUserMembership = community?.members?.find(m => m.id === userProfile?.uid);
    const canManageCommunityEvents = getEffectiveCommunityPermissions(
        community,
        currentUserMembership
    ).manageEvents;

    const showVisibility = showStatus !== undefined
        ? showStatus
        : (isSiteStaff || canManageCommunityEvents);

    return (
        <Link to={`/event/${event.id}`}>
            <article 
                className="rounded-lg shadow-md overflow-hidden transform hover:-translate-y-1 transition-transform duration-300 cursor-pointer flex flex-col relative group h-full ring-4 dark:bg-gray-800"
                style={{ 
                    backgroundColor: hexToRgba(themeColor, 0.2),
                    '--tw-ring-color': themeColor 
                }}
            >
                <div className="relative h-40 overflow-hidden">
                    <img 
                        src={event.bannerImageUrl || 'https://placehold.co/400x225/e2e8f0/64748b?text=Event'} 
                        alt={`${event.title} banner`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" 
                    />
                    {showVisibility && (
                        <div className={`absolute top-2 left-2 text-xs font-bold px-2 py-1 rounded-full text-white ${event.status === 'invisible' ? 'bg-yellow-500' : 'bg-green-500'}`}>
                            {event.status === 'invisible' ? 'Invisible' : 'Visible'}
                        </div>
                    )}
                </div>

                <div className="p-4 flex flex-col flex-grow">
                    <h3 className="text-xl font-bold mb-2 truncate dark:text-gray-100" title={event.title}>{event.title}</h3>

                    <p className="text-gray-700 dark:text-gray-300 flex-grow text-sm mb-4 h-10 overflow-hidden">
                        {event.description}
                    </p>

                    <div className="flex justify-center items-center mt-auto pt-2 border-t text-sm font-semibold text-gray-700 dark:text-gray-200" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
                        <span>{countdown}</span>
                    </div>
                </div>
            </article>
        </Link>
    );
};

export default EventCard;
