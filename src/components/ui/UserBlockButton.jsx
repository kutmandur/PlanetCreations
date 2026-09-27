import React, {useState} from 'react';
import {useUserBlocks} from '../../contexts/BlockingContext';
export default function UserBlockButton({targetUserId}) {
    const {userId, isBlocked, setBlocked} = useUserBlocks();
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    if (!userId || !targetUserId || userId === targetUserId) return null;
    const blocked = isBlocked(targetUserId);
    return <span><button type="button" disabled={busy} className="rounded-lg border px-3 py-2" onClick={async () => {
        setBusy(true); setError('');
        try { await setBlocked(targetUserId, !blocked); } catch (e) { setError(e.message || 'Unable to update block.'); }
        finally { setBusy(false); }
    }}>{busy ? 'Saving…' : blocked ? 'Unblock user' : 'Block user'}</button>{error && <span role="alert" className="block text-red-600">{error}</span>}</span>;
}
