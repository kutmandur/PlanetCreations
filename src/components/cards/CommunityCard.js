import React, { useCallback, memo } from 'react';
import { Link } from 'react-router-dom';
import { getGameColor } from '../../utils/helpers';
import { getEnabledGameIds, getGame } from '../../utils/gamesRegistry';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { fetchCommunityBySlug } from '../../firebase/communitiesService';
import { preloadComponent } from '../../utils/preload';

// Hilfsfunktion außerhalb der Komponente (kein Re-Create bei jedem Render)
const hexToRgba = (hex, alpha = 0.1) => {
    if (!hex) return `rgba(209, 213, 219, ${alpha})`;
    try {
        const [r, g, b] = hex.match(/\w\w/g).map(x => parseInt(x, 16));
        return `rgba(${r},${g},${b},${alpha})`;
    } catch (e) {
        return `rgba(209, 213, 219, ${alpha})`;
    }
};

const CommunityCard = memo(({ community, selectable = false, selected = false, onSelect }) => {
    const queryClient = useQueryClient();
    const { data: ownerProfile } = useQuery({
        queryKey: ['profile', community.ownerId],
        queryFn: async () => {
            const snapshot = await getDoc(doc(db, 'profiles', community.ownerId));
            return snapshot.exists() ? snapshot.data() : null;
        },
        enabled: !community.ownerUsername && !!community.ownerId,
        staleTime: 5 * 60 * 1000,
    });

    const themeColor = community.themeColor || '#6B7280';
    const allowedGames = community.allowedGames || getEnabledGameIds();
    const ownerUsername = community.ownerUsername || ownerProfile?.username || 'Unknown creator';

    const handlePrefetch = useCallback(() => {
        if (community.slug) {
            queryClient.prefetchQuery({
                queryKey: ['community', community.slug],
                queryFn: () => fetchCommunityBySlug(community.slug),
            });
        }
        preloadComponent('CommunityDetailPage');
    }, [queryClient, community.slug]);

    const card = (
            <article 
                className={`bg-white dark:bg-gray-800 rounded-lg shadow-lg overflow-hidden transform hover:-translate-y-1 transition-all duration-300 cursor-pointer flex flex-col relative group h-full ring-4 ${selected ? 'outline outline-4 outline-offset-2 outline-blue-500' : ''}`}
                style={{ '--tw-ring-color': themeColor }}
            >
                {selectable && (
                    <span className={`absolute z-10 top-3 right-3 w-8 h-8 rounded-full flex items-center justify-center border-2 shadow-md font-bold transition-colors ${selected ? 'bg-blue-600 border-white text-white' : 'bg-white/90 border-gray-300 text-transparent'}`} aria-hidden="true">✓</span>
                )}
                <div className="overflow-hidden h-48">
                    <img 
                        src={community.bannerImageUrl || 'https://placehold.co/400x225/333333/ffffff?text=Community'} 
                        alt={`${community.name} banner`}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" 
                    />
                </div>
                <div 
                    className="p-4 flex flex-col flex-grow"
                    style={{ backgroundColor: hexToRgba(themeColor) }}
                >
                    <h3 className="text-xl font-bold mb-2 truncate dark:text-gray-100" title={community.name}>{community.name}</h3>
                    <p className="text-gray-600 dark:text-gray-300 flex-grow text-sm mb-4 h-10 overflow-hidden">
                        {community.description}
                    </p>
                    <div className="flex justify-between items-center mt-auto pt-2 border-t" style={{ borderColor: 'rgba(0,0,0,0.1)' }}>
                        <div className="text-sm text-gray-500 dark:text-gray-400">
                            by <span className="font-semibold text-gray-700 dark:text-gray-200">{ownerUsername}</span>
                        </div>
                        <div className="text-sm font-semibold text-gray-800 dark:text-gray-100">
                            {community.memberCount} Members
                        </div>
                    </div>
                    <div className="flex justify-center items-center gap-2 mt-3 pt-3 border-t" style={{ borderColor: 'rgba(0,0,0,0.05)' }}>
                        {allowedGames.map(gameId => {
                             const color = getGameColor(gameId);
                             return (
                                <span key={gameId} style={color.style} className={`px-2 py-1 text-xs font-bold text-white rounded-full ${color.bg}`}>
                                    {getGame(gameId)?.shortName || gameId}
                                </span>
                             );
                        })}
                    </div>
                </div>
            </article>
    );

    if (selectable) {
        return (
            <button type="button" onClick={() => onSelect?.(community.id)} aria-pressed={selected} className="block w-full h-full text-left rounded-lg focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-500">
                {card}
            </button>
        );
    }

    return (
        <Link to={`/community/${community.slug}`} onMouseEnter={handlePrefetch} onTouchStart={handlePrefetch}>
            {card}
        </Link>
    );
});

export default CommunityCard;
