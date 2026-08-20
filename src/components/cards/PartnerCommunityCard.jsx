import React, { memo, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { fetchCommunityBySlug } from '../../firebase/communitiesService';
import { useCommunityYoutubeVideos } from '../../hooks/youtubeVideoIndex';
import { getYoutubeThumbnailUrl, SOCIAL_PLATFORMS } from '../../utils/helpers';
import { getEnabledGameIds, getGame } from '../../utils/gamesRegistry';
import { preloadComponent } from '../../utils/preload';
import Icon from '../ui/Icon';
import OfficialPartnerBadge from '../community/OfficialPartnerBadge';

const hexToRgba = (hex, alpha = 0.08) => {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return `rgba(107, 114, 128, ${alpha})`;
    const value = Number.parseInt(hex.slice(1), 16);
    return `rgba(${value >> 16}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
};

const YoutubeGallery = ({ videos }) => {
    if (videos.length === 0) return null;

    return (
        <section className="w-full" aria-label="Latest YouTube videos">
            <h3 className="mb-3 text-center text-xs font-bold uppercase tracking-[0.18em] text-gray-500 dark:text-gray-400">
                Latest videos
            </h3>
            <div className="grid w-full grid-cols-3 items-stretch gap-3 sm:gap-4">
                {videos.map(video => {
                    const videoUrl = `https://www.youtube.com/watch?v=${video.id}`;
                    return (
                        <a
                            key={video.id}
                            href={videoUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            aria-label={`Watch ${video.title} on YouTube`}
                            className="group/video flex min-w-0 flex-col overflow-hidden rounded-xl bg-white text-left shadow-md transition hover:-translate-y-0.5 hover:shadow-lg dark:bg-gray-900"
                        >
                            <div className="relative aspect-video overflow-hidden bg-gray-200 dark:bg-gray-700">
                                <img
                                    src={getYoutubeThumbnailUrl(videoUrl, 'mqdefault')}
                                    alt=""
                                    className="h-full w-full object-cover transition-transform duration-300 group-hover/video:scale-105"
                                />
                                <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
                                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-red-600/95 shadow">
                                        <span className="ml-0.5 h-0 w-0 border-y-[6px] border-l-[10px] border-y-transparent border-l-white" />
                                    </span>
                                </span>
                            </div>
                            <p className="flex-1 break-words px-3 py-3 text-center text-xs font-semibold leading-5 text-gray-800 dark:text-gray-100 sm:text-sm">
                                {video.title}
                            </p>
                        </a>
                    );
                })}
            </div>
        </section>
    );
};

const PartnerCommunityCard = memo(({ community }) => {
    const queryClient = useQueryClient();
    const navigate = useNavigate();
    const { data: ownerProfile } = useQuery({
        queryKey: ['profile', community.ownerId],
        queryFn: async () => {
            const snapshot = await getDoc(doc(db, 'profiles', community.ownerId));
            return snapshot.exists() ? snapshot.data() : null;
        },
        enabled: !community.ownerUsername && !!community.ownerId,
        staleTime: 5 * 60 * 1000,
    });

    const youtubeChannelUrl = community.socialLinks?.youtube || null;
    const {
        videos: indexedVideos,
        isLoading: videosLoading,
    } = useCommunityYoutubeVideos(community.id, {
        minimumVideos: 3,
        pageSize: 3,
    });

    const themeColor = community.themeColor || '#6B7280';
    const ownerUsername = community.ownerUsername || ownerProfile?.username || 'Unknown creator';
    const allowedGames = community.allowedGames || getEnabledGameIds();
    const memberCount = Number(community.memberCount) || 0;
    const latestVideos = useMemo(
        () => (youtubeChannelUrl ? indexedVideos.slice(0, 3) : []),
        [indexedVideos, youtubeChannelUrl]
    );
    const linkedSocialPlatforms = SOCIAL_PLATFORMS.filter(
        platform => community.socialLinks?.[platform.id]
    );

    const handlePrefetch = useCallback(() => {
        if (community.slug) {
            queryClient.prefetchQuery({
                queryKey: ['community', community.slug],
                queryFn: () => fetchCommunityBySlug(community.slug),
            });
        }
        preloadComponent('CommunityDetailPage');
    }, [community.slug, queryClient]);

    const handleCardClick = useCallback(event => {
        if (event.target.closest('a, button, input, select, textarea, [role="button"]')) return;
        navigate(`/community/${community.slug}`);
    }, [community.slug, navigate]);

    return (
        <article
            className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-2xl border-2 bg-white text-center shadow-xl transition duration-300 hover:-translate-y-1 hover:shadow-2xl dark:bg-gray-800"
            style={{ borderColor: themeColor }}
            onClick={handleCardClick}
            onMouseEnter={handlePrefetch}
            onTouchStart={handlePrefetch}
        >
            <Link
                to={`/community/${community.slug}`}
                aria-label={`Open ${community.name} banner`}
                className="relative block h-44 overflow-hidden focus:outline-none focus-visible:ring-4 focus-visible:ring-inset focus-visible:ring-yellow-400 sm:h-48"
            >
                <img
                    src={community.bannerImageUrl || 'https://placehold.co/900x450/333333/ffffff?text=Partner+Community'}
                    alt={`${community.name} banner`}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                />
                <OfficialPartnerBadge
                    variant="card"
                    communityName={community.name}
                    logoUrl={community.profileImageUrl}
                />
            </Link>

            <div
                className="flex flex-1 flex-col items-center p-5 sm:p-6"
                style={{ backgroundImage: `linear-gradient(${hexToRgba(themeColor)}, ${hexToRgba(themeColor)})` }}
            >
                <p className="mb-2 text-xs font-bold uppercase tracking-[0.2em] text-yellow-600 dark:text-yellow-400">
                    Official Partner
                </p>
                <Link
                    to={`/community/${community.slug}`}
                    className="rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
                >
                    <h2 className="text-2xl font-bold leading-tight text-gray-900 dark:text-white sm:text-3xl">
                        {community.name}
                    </h2>
                </Link>

                <p className="mt-3 line-clamp-3 max-w-2xl text-sm leading-6 text-gray-600 dark:text-gray-300 sm:text-base">
                    {community.description || 'Discover this official PlanetCreations partner community.'}
                </p>

                <div className="my-5 h-px w-full bg-black/10 dark:bg-white/10" />

                {videosLoading && youtubeChannelUrl ? (
                    <div className="mb-5 grid w-full grid-cols-3 gap-3 sm:gap-4" aria-label="Loading latest YouTube videos">
                        {[0, 1, 2].map(item => (
                            <div key={item} className="aspect-video min-w-0 animate-pulse rounded-xl bg-gray-200 dark:bg-gray-700" />
                        ))}
                    </div>
                ) : (
                    <YoutubeGallery videos={latestVideos} />
                )}

                <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm text-gray-600 dark:text-gray-300">
                    <span><strong className="text-gray-900 dark:text-white">{memberCount.toLocaleString()}</strong> members</span>
                    <span aria-hidden="true">•</span>
                    <span>Owned by <strong className="text-gray-900 dark:text-white">{ownerUsername}</strong></span>
                </div>

                {linkedSocialPlatforms.length > 0 && (
                    <div className="mt-3 flex flex-wrap justify-center gap-2" aria-label="Community social links">
                        {linkedSocialPlatforms.map(platform => (
                            <a
                                key={platform.id}
                                href={community.socialLinks[platform.id]}
                                target="_blank"
                                rel="noopener noreferrer"
                                aria-label={`Open ${platform.label}`}
                                title={platform.label}
                                className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-900 text-white shadow-md transition hover:-translate-y-0.5 hover:brightness-125 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 dark:bg-gray-100 dark:text-gray-900"
                            >
                                <Icon path={platform.icon} solid={platform.solid} className="h-5 w-5" />
                            </a>
                        ))}
                    </div>
                )}

                <Link
                    to={`/community/${community.slug}`}
                    className="mt-5 rounded-full px-5 py-2 text-sm font-bold text-white shadow transition hover:brightness-110 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400"
                    style={{ backgroundColor: themeColor }}
                >
                    View community →
                </Link>

                <div className="mt-4 flex flex-wrap justify-center gap-2">
                    {allowedGames.map(gameId => {
                        const game = getGame(gameId);
                        const isMainGame = community.mainGame === gameId;
                        return (
                            <span
                                key={gameId}
                                className="rounded-full px-3 py-1 text-xs font-bold text-white shadow-sm"
                                style={{ backgroundColor: game?.color || themeColor }}
                            >
                                {game?.name || gameId}{isMainGame ? ' · Main game' : ''}
                            </span>
                        );
                    })}
                </div>
            </div>
        </article>
    );
});

export default PartnerCommunityCard;
