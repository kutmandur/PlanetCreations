import React, { useCallback, memo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { fetchCreationById } from '../../firebase/creationsService';
import { ICONS, getTextColorForBackground } from '../../utils/helpers';
import { POOL_LABELS } from '../../utils/feedRanking';
import { isLiveStreamActive } from '../../utils/liveStream';
import Icon from '../ui/Icon';
import { preloadComponent } from '../../utils/preload';
import useHoverSlideshow from '../../hooks/useHoverSlideshow';

const CreationCard = memo(({ creation, isLink = true, onTagClick }) => {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const { imgSrc, onMouseEnter: startHover, onMouseLeave: stopHover } = useHoverSlideshow(creation);

    const handlePrefetch = useCallback(() => {
        // Prefetch der Creation-Daten via React Query
        queryClient.prefetchQuery({
            queryKey: ['creation', creation.id],
            queryFn: () => fetchCreationById(creation.id),
        });

        // Prefetch des Creator-Profils (wichtig für schnelle Detail-Ansicht)
        if (creation.userId) {
            queryClient.prefetchQuery({
                queryKey: ['profile', creation.userId],
                queryFn: async () => {
                    const snap = await getDoc(doc(db, 'profiles', creation.userId));
                    return snap.exists() ? snap.data() : null;
                },
            });
        }

        // Preload der CreationDetail Komponente
        preloadComponent('CreationDetail');
    }, [queryClient, creation.id, creation.userId]);

    const handleMouseEnter = useCallback(() => {
        startHover();
        handlePrefetch();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handlePrefetch]);

    const handleProfileClick = useCallback((e) => {
        // preventDefault, damit der umgebende <Link> zur Creation nicht
        // zusätzlich navigiert (sonst landen zwei Einträge in der History).
        e.preventDefault();
        e.stopPropagation();
        preloadComponent('ProfilePage');
        navigate(`/profile/${creation.userId}`);
    }, [navigate, creation.userId]);

    const handleTagClick = useCallback((e, tag) => {
        e.preventDefault();
        e.stopPropagation();
        if (onTagClick) {
            onTagClick(tag);
        }
    }, [onTagClick]);

    const isLive = isLiveStreamActive(creation.liveStream);

    const CardContent = () => (
        <article className={`bg-white dark:bg-gray-800 rounded-lg shadow-md overflow-hidden transform hover:-translate-y-1 transition-transform duration-300 cursor-pointer flex flex-col relative group h-full ${isLive ? 'ring-2 ring-red-500' : ''}`}>
            <div className="relative h-48 overflow-hidden">
                {isLive && (
                    <span className="absolute top-2 left-2 z-10 bg-red-600 text-white text-[10px] font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wide flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse"></span> Live
                    </span>
                )}
                <img
                    src={imgSrc}
                    alt={creation.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                    onError={(e) => { e.target.onerror = null; e.target.src='https://placehold.co/400x225/333333/ffffff?text=Image+Missing'; }}
                />
                <div className="absolute top-2 right-2 flex flex-col items-center gap-y-2">
                    <div className={`w-3 h-3 rounded-full ring-2 ring-white ${creation.status === 'finished' ? 'bg-green-500' : 'bg-orange-500'}`} title={creation.status === 'finished' ? 'Finished' : 'Work in Progress'}></div>
                    {creation.modStatus === 'UsingMods' && <div className="w-3 h-3 rounded-full ring-2 ring-white bg-purple-500" title="Uses Mods"></div>}
                </div>
                {creation.__feedDebug && (
                    // Admin-Debug: aus welchem Pool dieser Eintrag im
                    // Recommended-Feed gezogen wurde (+ Komponenten-Scores im Tooltip)
                    <div
                        className={`absolute ${isLive ? 'top-8' : 'top-2'} left-2 bg-black bg-opacity-75 text-white text-[10px] font-mono px-2 py-1 rounded-md`}
                        title={Object.entries(creation.__feedDebug.parts)
                            .map(([k, v]) => `${k}: ${v.toFixed(3)}`)
                            .join('\n')}
                    >
                        {POOL_LABELS[creation.__feedDebug.pool] || creation.__feedDebug.pool}
                        {' · '}
                        {creation.__feedDebug.score.toFixed(2)}
                    </div>
                )}
                <div className="absolute bottom-2 left-2 bg-black bg-opacity-60 text-white px-2 py-1 rounded-md text-xs font-semibold">
                    <div onClick={handleProfileClick} className="hover:underline flex items-center">
                        <img src={creation.userProfilePictureUrl || 'https://placehold.co/24x24/e2e8f0/64748b?text=P'} alt={creation.username} className="w-6 h-6 rounded-full mr-2 border-2 border-white" />
                        <span>
                            {creation.username}
                        </span>
                    </div>
                </div>
            </div>

            <div className="p-4 flex flex-col flex-grow">
                <h3 className="text-xl font-bold mb-2 truncate text-center" title={creation.title}>{creation.title}</h3>
                <p className="text-gray-600 dark:text-gray-400 flex-grow text-sm mb-2 h-10 overflow-hidden text-center">
                    {creation.description}
                </p>
                {creation.creatorRanks?.length > 0 && (
                    <div className="flex flex-wrap justify-center gap-1 mb-4">
                        {creation.creatorRanks.map(rank => (
                            <span key={rank.name} className="text-[10px] font-semibold px-2 py-0.5 rounded-full capitalize" style={{ backgroundColor: rank.color || '#6B7280', color: getTextColorForBackground(rank.color || '#6B7280') }}>
                                {rank.name}
                            </span>
                        ))}
                    </div>
                )}
                <div className="flex justify-between items-center mt-auto pt-2 border-t dark:border-gray-700">
                    <div className="flex space-x-3 text-sm">
                        <span className="flex items-center"><Icon path={ICONS.thumbUp} className="w-5 h-5 mr-1 text-green-500" solid/> {creation.likes || 0}</span>
                        <span className="flex items-center"><Icon path={ICONS.thumbDown} className="w-5 h-5 mr-1 text-red-500" solid/> {creation.dislikes || 0}</span>
                    </div>
                    <div className="flex flex-wrap gap-1 justify-end">
                        {creation.tags?.slice(0, 2).map(tag => (
                            <button
                                key={tag}
                                onClick={(e) => handleTagClick(e, tag)}
                                className={`text-xs bg-gray-200 dark:bg-gray-700 dark:text-gray-200 px-2 py-1 rounded-full ${onTagClick ? 'hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors cursor-pointer' : 'cursor-default'}`}
                                disabled={!onTagClick}
                            >
                                {tag}
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </article>
    );

    return isLink ? (
        <Link
            to={`/creation/${creation.id}`}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={stopHover}
            onTouchStart={handlePrefetch}
        >
            <CardContent />
        </Link>
    ) : (
        <div
            onMouseEnter={handleMouseEnter}
            onMouseLeave={stopHover}
            onTouchStart={handlePrefetch}
        >
            <CardContent />
        </div>
    );
});

export default CreationCard;
