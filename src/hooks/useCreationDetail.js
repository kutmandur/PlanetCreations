import { useQuery } from '@tanstack/react-query';
import { fetchCreationById } from '../firebase/creationsService';

export const useCreationDetail = (creationId) => {
    return useQuery({
        // The key is unique to this specific creation
        queryKey: ['creation', creationId],
        
        // The query function calls our service function to fetch the data
        queryFn: () => fetchCreationById(creationId),

        // This option prevents the query from running if the creationId is not yet available
        enabled: !!creationId,
    });
};