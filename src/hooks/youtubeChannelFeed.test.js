import { youtubeChannelFeedOptions } from './youtubeChannelFeed';

describe('youtubeChannelFeedOptions', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test('uses the same-origin Vite proxy during local development', async () => {
        const response = { videos: [] };
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => response,
        });
        vi.stubGlobal('fetch', fetchMock);

        const options = youtubeChannelFeedOptions('https://www.youtube.com/@PlanetCoaster');
        await expect(options.queryFn()).resolves.toEqual(response);

        expect(fetchMock).toHaveBeenCalledWith(
            '/api/youtubeChannelFeed?url=https%3A%2F%2Fwww.youtube.com%2F%40PlanetCoaster'
        );
    });
});
