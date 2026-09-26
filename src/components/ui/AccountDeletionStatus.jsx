import React, {useEffect, useState} from 'react';
import {getFunctions, httpsCallable} from 'firebase/functions';
import {DELETION_RECEIPT_KEY} from '../../firebase/accountDeletion';

export default function AccountDeletionStatus() {
    const [receipt] = useState(() => localStorage.getItem(DELETION_RECEIPT_KEY));
    const [state, setState] = useState('pending');
    useEffect(() => {
        if (!receipt) return undefined;
        let stopped = false;
        const check = async () => {
            try {
                const result = await httpsCallable(getFunctions(), 'getAccountDeletionStatus')({receipt});
                if (!stopped) setState(result.data.state);
            } catch { if (!stopped) setState('unavailable'); }
        };
        check();
        const timer = setInterval(check, 30000);
        return () => { stopped = true; clearInterval(timer); };
    }, [receipt]);
    if (!receipt) return null;
    return <div role="status" className="fixed bottom-4 left-4 right-4 z-[100] rounded-xl border bg-white p-4 text-gray-900 shadow-lg">
        {state === 'complete' ? 'Account deletion completed.' : state === 'retrying' ?
            'Account deletion is still in progress. A cleanup step will be retried automatically.' : state === 'unavailable' ?
                'The deletion status is temporarily unavailable. This does not cancel your request.' :
                'Your account deletion request was accepted. Cleanup is running and may take several minutes.'}
        {localStorage.getItem('pc-clear-firestore-cache') && <p>Close other open PlanetCreations tabs and reload to clear the local account cache.</p>}
        {state === 'complete' && <button className="ml-4 underline" onClick={() => { localStorage.removeItem(DELETION_RECEIPT_KEY); window.location.reload(); }}>Dismiss</button>}
    </div>;
}
