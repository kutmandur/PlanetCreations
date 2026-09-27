import {useLocation} from 'react-router-dom';
import React, {useEffect, useState} from 'react';
import {onAuthStateChanged} from 'firebase/auth';
import {collection, onSnapshot} from 'firebase/firestore';
import {httpsCallable, getFunctions} from 'firebase/functions';
import {auth, db} from '../../firebase/config';
import {BlockingContext} from '../../contexts/BlockingContext';

export default function UserBlockingProvider({children}) {
    const location = useLocation();
    const enabled = !location.pathname.startsWith('/client/');
    const [state, setState] = useState({userId: null, blocks: [], error: ''});
    useEffect(() => {
        if (!enabled) { setState({userId:null,blocks:[],error:''}); return undefined; }
        let stopBlocks = () => {};
        let generation = 0;
        const stopAuth = onAuthStateChanged(auth, user => {
            stopBlocks();
            const currentGeneration = ++generation;
            setState({userId: user?.uid || null, blocks: [], error: ''});
            if (user) stopBlocks = onSnapshot(collection(db, 'users', user.uid, 'blocks'), snap => {
                if (currentGeneration !== generation) return;
                setState({userId: user.uid, blocks: snap.docs.map(doc => ({id: doc.id, ...doc.data()})), error: ''});
            }, () => {if (currentGeneration === generation) setState(previous => ({...previous, error: 'The blocked accounts list is temporarily unavailable.'}));});
        });
        return () => { generation++; stopBlocks(); stopAuth(); };
    }, [enabled]);
    const setBlocked = async (targetUserId, blocked) => {
        await httpsCallable(getFunctions(), 'setUserBlock')({targetUserId, blocked});
    };
    return <BlockingContext.Provider value={{...state, setBlocked, isBlocked: uid => state.blocks.some(block => block.id === uid)}}>{children}</BlockingContext.Provider>;
}
