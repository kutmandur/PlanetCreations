import { useQuery } from '@tanstack/react-query';
import { fetchAllCommunities } from '../firebase/communitiesService';

export const useCommunities = () => {
    return useQuery({
        queryKey: ['communities'],
        queryFn: fetchAllCommunities,
    });
};