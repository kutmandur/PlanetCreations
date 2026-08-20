import { useCallback, useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    fetchYoutubeVideoIndexShard,
    fetchYoutubeVideoIndexState,
} from '../firebase/youtubeVideoIndexService';

const INDEX_STALE_TIME_MS = 15 * 60 * 1000;

export const youtubeVideoIndexStateOptions = () => ({
    queryKey: ['youtube-video-index-state'],
    queryFn: fetchYoutubeVideoIndexState,
    staleTime: INDEX_STALE_TIME_MS,
});

export const youtubeVideoIndexShardOptions = (shardId) => ({
    queryKey: ['youtube-video-index-shard', shardId],
    queryFn: () => fetchYoutubeVideoIndexShard(shardId),
    staleTime: INDEX_STALE_TIME_MS,
});

export const decodeIndexedYoutubeVideo = (id, encoded) => {
    const value = String(encoded || '');
    const separatorIndex = value.indexOf('|');
    if (!/^[\w-]{11}$/.test(id) || separatorIndex < 0) return null;
    const publishedMs = Number(value.slice(0, separatorIndex));
    return {
        id,
        published: Number.isFinite(publishedMs) && publishedMs > 0
            ? new Date(publishedMs).toISOString()
            : null,
        publishedMs: Number.isFinite(publishedMs) ? publishedMs : 0,
        title: value.slice(separatorIndex + 1),
    };
};

export const getCommunityVideosFromShard = (shard, communityId) => (
    Object.entries(shard?.c?.[communityId] || {})
        .map(([id, encoded]) => decodeIndexedYoutubeVideo(id, encoded))
        .filter(Boolean)
        .sort((first, second) => second.publishedMs - first.publishedMs)
);

const mergeShardVideos = (pages) => {
    const byId = new Map();
    pages.flatMap(page => page.videos).forEach(video => {
        const existing = byId.get(video.id);
        if (!existing || video.publishedMs > existing.publishedMs) {
            byId.set(video.id, video);
        }
    });
    return [...byId.values()].sort(
        (first, second) => second.publishedMs - first.publishedMs
    );
};

export const useCommunityYoutubeVideos = (
    communityId,
    { pageSize = 15, minimumVideos = pageSize } = {}
) => {
    const queryClient = useQueryClient();
    const [visibleCount, setVisibleCount] = useState(pageSize);
    const stateQuery = useQuery({
        ...youtubeVideoIndexStateOptions(),
        enabled: !!communityId,
    });
    const headShardId = stateQuery.data?.headShardId || null;

    useEffect(() => {
        setVisibleCount(pageSize);
    }, [communityId, pageSize]);

    const shardsQuery = useInfiniteQuery({
        queryKey: ['youtube-community-video-shards', communityId, headShardId],
        enabled: !!communityId && !!headShardId,
        initialPageParam: headShardId,
        queryFn: async ({ pageParam }) => {
            const shard = await queryClient.fetchQuery(
                youtubeVideoIndexShardOptions(pageParam)
            );
            return {
                previousShardId: shard?.p || null,
                shardId: pageParam,
                videos: getCommunityVideosFromShard(shard, communityId),
            };
        },
        getNextPageParam: lastPage => lastPage.previousShardId || undefined,
        staleTime: INDEX_STALE_TIME_MS,
    });

    const bufferedVideos = useMemo(
        () => mergeShardVideos(shardsQuery.data?.pages || []),
        [shardsQuery.data?.pages]
    );
    const targetCount = Math.max(minimumVideos, visibleCount);
    const needsOlderShard = Boolean(
        headShardId &&
        shardsQuery.isSuccess &&
        shardsQuery.hasNextPage &&
        !shardsQuery.isFetchingNextPage &&
        bufferedVideos.length < targetCount
    );

    useEffect(() => {
        if (needsOlderShard) void shardsQuery.fetchNextPage();
    }, [needsOlderShard, shardsQuery.fetchNextPage]);

    const loadMore = useCallback(() => {
        setVisibleCount(current => current + pageSize);
    }, [pageSize]);

    return {
        bufferedCount: bufferedVideos.length,
        error: stateQuery.error || shardsQuery.error,
        hasMore: bufferedVideos.length > visibleCount || Boolean(shardsQuery.hasNextPage),
        isFetchingMore: shardsQuery.isFetchingNextPage,
        isLoading: stateQuery.isPending ||
            (!!headShardId && shardsQuery.isPending) || needsOlderShard,
        loadMore,
        videos: bufferedVideos.slice(0, visibleCount),
    };
};
