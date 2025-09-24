import { useQuery } from '@tanstack/react-query';
import { fetchCommunityBySlug } from '../firebase/communitiesService';

export const useCommunityDetail = (slug) => {
    return useQuery({
        queryKey: ['community', slug],
        queryFn: () => fetchCommunityBySlug(slug),
        enabled: !!slug, // Only run the query if the slug is available
    });
};