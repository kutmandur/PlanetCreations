import React, {useEffect, useState} from 'react';
import {getFunctions, httpsCallable} from 'firebase/functions';
import {DELETION_RECEIPT_KEY} from '../../firebase/accountDeletion';
import {deletionStatusMessage} from '../../utils/deletionStatus';

export default function AccountDeletionStatus() {
    const [receipt] = useState(() => localStorage.getItem(DELETION_RECEIPT_KEY));
    const [status, setStatus] = useState({});
    useEffect(() => {
        if (!receipt) return undefined;
        let stopped = false;
        const check = async () => {
            try {
                const result = await httpsCallable(getFunctions(), 'getAccountDeletionStatus')({receipt});
                if (!stopped) setStatus(result.data);
            } catch (error) { if (!stopped) setStatus({state:error.code === 'functions/not-found' ? 'missing' : 'unavailable'}); }
        };
        check();
        const timer = setInterval(check, 30000);
        return () => { stopped = true; clearInterval(timer); };
    }, [receipt]);
    if (!receipt) return null;
    return <div role="status" className="fixed bottom-4 left-4 right-4 z-[100] rounded-xl border bg-white p-4 text-gray-900 shadow-lg">
        <p>{deletionStatusMessage(status)}</p>
        {status.state !== 'complete' && status.earliestProcessingAt && <p>Earliest cleanup: {new Date(status.earliestProcessingAt).toLocaleString()}. Phase: {status.phase}.</p>}
        {status.needsAttention && <p>Your request has been pending for over 24 hours. Please contact support through the <a className="underline" href="/impressum">Legal Notice</a>. Automatic retries continue.</p>}
        {localStorage.getItem('pc-clear-firestore-cache') && <p>Close other open PlanetCreations tabs and reload to clear the local account cache.</p>}
        {['complete','expired'].includes(status.state) && <button className="mt-2 underline" onClick={() => { localStorage.removeItem(DELETION_RECEIPT_KEY); window.location.reload(); }}>{status.state === 'missing' ? 'Discard this unavailable receipt' : 'Dismiss'}</button>}
    </div>;
}
