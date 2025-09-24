import { useInfiniteQuery } from '@tanstack/react-query';
import { fetchCreations } from '../firebase/creationsService';

export const useCreations = (activeTab, sortBy) => {
    return useInfiniteQuery({
        queryKey: ['creations', activeTab, sortBy],
        
        queryFn: fetchCreations,
        
        getNextPageParam: (lastPage) => lastPage.lastVisible || undefined,

        initialPageParam: null,
    });
};