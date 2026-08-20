vi.mock('../firebase/youtubeVideoIndexService', () => ({
    fetchYoutubeVideoIndexShard: vi.fn(),
    fetchYoutubeVideoIndexState: vi.fn(),
}));

import React from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
    fetchYoutubeVideoIndexShard,
    fetchYoutubeVideoIndexState,
} from '../firebase/youtubeVideoIndexService';
import {
    decodeIndexedYoutubeVideo,
    getCommunityVideosFromShard,
    useCommunityYoutubeVideos,
} from './youtubeVideoIndex';

describe('YouTube video index decoding', () => {
    test('decodes compact entries and keeps separators inside titles', () => {
        expect(decodeIndexedYoutubeVideo(
            'abcdefghijk',
            '1787184000000|A title | with separator'
        )).toMatchObject({
            id: 'abcdefghijk',
            publishedMs: 1787184000000,
            title: 'A title | with separator',
        });
    });

    test('selects one community and sorts its videos newest first', () => {
        const videos = getCommunityVideosFromShard({
            c: {
                'community-1': {
                    abcdefghijk: '1000|Older',
                    lmnopqrstuv: '2000|Newest',
                },
                'community-2': {
                    zyxwvutsrqp: '3000|Different community',
                },
            },
        }, 'community-1');

        expect(videos.map(video => video.title)).toEqual(['Newest', 'Older']);
    });
});

describe('useCommunityYoutubeVideos', () => {
    test('walks backwards through empty shards until it has fifteen videos', async () => {
        fetchYoutubeVideoIndexState.mockResolvedValue({ headShardId: '000002' });
        fetchYoutubeVideoIndexShard.mockImplementation(async shardId => {
            if (shardId === '000002') return { id: shardId, p: '000001', c: {} };
            return {
                id: shardId,
                p: null,
                c: {
                    'community-1': Object.fromEntries(
                        Array.from({ length: 15 }, (_, index) => [
                            String(index + 1).padStart(11, '0'),
                            `${2000 - index}|Video ${index + 1}`,
                        ])
                    ),
                },
            };
        });
        const queryClient = new QueryClient({
            defaultOptions: { queries: { retry: false } },
        });
        const wrapper = ({ children }) => React.createElement(
            QueryClientProvider,
            { client: queryClient },
            children
        );
        const { result } = renderHook(
            () => useCommunityYoutubeVideos('community-1'),
            { wrapper }
        );

        await waitFor(() => expect(result.current.videos).toHaveLength(15));
        expect(fetchYoutubeVideoIndexShard).toHaveBeenCalledWith('000002');
        expect(fetchYoutubeVideoIndexShard).toHaveBeenCalledWith('000001');
    });
});
