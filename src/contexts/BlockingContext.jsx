import {createContext, useContext} from 'react';
export const BlockingContext = createContext({userId: null, blocks: [], error: '', isBlocked: () => false});
export const useUserBlocks = () => useContext(BlockingContext);
