import React from 'react';
import {Link} from 'react-router-dom';
import {useUserBlocks} from '../../contexts/BlockingContext';
import UserBlockButton from './UserBlockButton';
export default function BlockedUsersSettings() {
    const {blocks, error} = useUserBlocks();
    return <section className="rounded-lg border p-4"><h2 className="text-xl font-bold">Blocked accounts</h2>
        <p>Blocking hides their content in your feeds and prevents direct invitations and related notifications. Shared projects, files, roles and event results stay intact. Public content remains accessible outside your account.</p>
        {error && <p role="alert">{error}</p>}
        {!blocks.length && !error && <p>No blocked accounts.</p>}
        {blocks.map(block => <div key={block.id} className="flex items-center justify-between gap-3 py-2"><Link to={`/profile/${block.id}`}>{block.targetUsername || block.id}</Link><UserBlockButton targetUserId={block.id} /></div>)}
    </section>;
}
