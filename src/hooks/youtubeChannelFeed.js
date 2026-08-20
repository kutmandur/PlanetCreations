import { useQuery } from '@tanstack/react-query';

const API_BASE_URL = import.meta.env.DEV
    ? '/api'
    : import.meta.env.VITE_API_BASE_URL ||
        'https://us-central1-planetcreationsdotnet.cloudfunctions.net/api';

// Geteilte React-Query-Optionen für den YouTube-Kanal-Feed, damit die Community-Seite
// (Prefetch) und der Videos-Tab (Anzeige) denselben Cache-Key + Fetch nutzen.
// Die Daten kommen via Cloud-Function-Proxy aus YouTubes öffentlichem RSS-Feed
// oder dessen Kanalseiten-Fallback; serverseitig werden sie 15 min gecacht.
export const youtubeChannelFeedOptions = (url) => ({
    queryKey: ['youtubeChannelFeed', url],
    queryFn: async () => {
        const response = await fetch(`${API_BASE_URL}/youtubeChannelFeed?url=${encodeURIComponent(url)}`);
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || `HTTP ${response.status}`);
        return result;
    },
    enabled: !!url,
    staleTime: 15 * 60 * 1000,
    retry: 1,
});

export const useYoutubeChannelFeed = (url) => useQuery(youtubeChannelFeedOptions(url));
