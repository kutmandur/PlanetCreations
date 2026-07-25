import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
    getCollaborationJoinInfo,
    joinCollaborationByCode,
    joinCollaborationByPassword,
    applyToCollaboration,
} from '../../firebase/collaboration';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

// Landing für /collaboration/join/:inviteCode. Löst den Code auf und zeigt je nach
// joinMode die passende UI (Direktbeitritt / Passwort / Bewerbung).
const JoinCollaborationPage = ({ user, setModalMessage }) => {
    const { inviteCode } = useParams();
    const navigate = useNavigate();
    const [status, setStatus] = useState('loading'); // loading|ready|joining|success|applied|error|login_required
    const [error, setError] = useState('');
    const [info, setInfo] = useState(null);
    const [collaborationId, setCollaborationId] = useState(null);
    const [password, setPassword] = useState('');
    const [message, setMessage] = useState('');

    useEffect(() => {
        if (!inviteCode) {
            setStatus('error');
            setError('No invite code provided.');
            return;
        }
        if (!user) {
            setStatus('login_required');
            return;
        }
        let mounted = true;
        (async () => {
            try {
                const joinInfo = await getCollaborationJoinInfo(inviteCode);
                if (!mounted) return;
                setInfo(joinInfo);
                setCollaborationId(joinInfo.collaborationId);
                if (joinInfo.alreadyMember) {
                    setStatus('success');
                } else if (joinInfo.joinMode === 'application' && joinInfo.applicationStatus === 'pending') {
                    setStatus('applied');
                } else {
                    setStatus('ready');
                }
            } catch (err) {
                if (!mounted) return;
                setStatus('error');
                setError(err.message);
            }
        })();
        return () => { mounted = false; };
    }, [inviteCode, user]);

    const handleJoinInvite = useCallback(async () => {
        setStatus('joining');
        try {
            const id = await joinCollaborationByCode(user.uid, inviteCode);
            setCollaborationId(id);
            setStatus('success');
        } catch (err) {
            setModalMessage(err.message);
            setStatus('ready');
        }
    }, [user, inviteCode, setModalMessage]);

    const handleJoinPassword = useCallback(async () => {
        if (password.trim().length < 4) {
            setModalMessage('Please enter the join password.');
            return;
        }
        setStatus('joining');
        try {
            const id = await joinCollaborationByPassword(inviteCode, password.trim());
            setCollaborationId(id);
            setStatus('success');
        } catch (err) {
            setModalMessage(err.message);
            setStatus('ready');
        }
    }, [inviteCode, password, setModalMessage]);

    const handleApply = useCallback(async () => {
        setStatus('joining');
        try {
            await applyToCollaboration(inviteCode, message.trim());
            setStatus('applied');
        } catch (err) {
            setModalMessage(err.message);
            setStatus('ready');
        }
    }, [inviteCode, message, setModalMessage]);

    const cardTitle = info?.title ? `“${info.title}”` : 'this collaboration';

    return (
        <div className="flex min-h-full items-center justify-center bg-gray-100 p-4 dark:bg-gray-900">
            <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-lg dark:bg-gray-800">
                {(status === 'loading' || status === 'joining') && (
                    <div className="p-8 text-center">
                        <Spinner />
                        <p className="mt-4 text-gray-600 dark:text-gray-300">
                            {status === 'joining' ? 'Working…' : 'Loading…'}
                        </p>
                    </div>
                )}

                {status === 'ready' && info && (
                    <div className="p-8">
                        <h1 className="mb-1 text-center text-2xl font-bold text-gray-800 dark:text-gray-100">Join {cardTitle}</h1>

                        {info.joinMode === 'invite' && (
                            <>
                                <p className="mb-6 text-center text-gray-600 dark:text-gray-300">You've been invited to collaborate. Ready to join?</p>
                                <button onClick={handleJoinInvite} className="w-full rounded-lg bg-indigo-500 py-3 font-bold text-white transition-colors hover:bg-indigo-600">
                                    Join collaboration
                                </button>
                            </>
                        )}

                        {info.joinMode === 'password' && (
                            <>
                                <p className="mb-4 text-center text-gray-600 dark:text-gray-300">This collaboration is password-protected. Enter the password to join.</p>
                                <input
                                    type="text"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Join password"
                                    className="mb-3 w-full rounded-lg border border-gray-300 p-3 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                                    onKeyDown={(e) => e.key === 'Enter' && handleJoinPassword()}
                                />
                                <button onClick={handleJoinPassword} className="w-full rounded-lg bg-indigo-500 py-3 font-bold text-white transition-colors hover:bg-indigo-600">
                                    Join collaboration
                                </button>
                            </>
                        )}

                        {info.joinMode === 'application' && (
                            <>
                                <p className="mb-4 text-center text-gray-600 dark:text-gray-300">This collaboration reviews applications. Send a request and an owner will approve it.</p>
                                <textarea
                                    value={message}
                                    onChange={(e) => setMessage(e.target.value)}
                                    rows={3}
                                    maxLength={300}
                                    placeholder="Optional: a short message to the owner…"
                                    className="mb-3 w-full resize-none rounded-lg border border-gray-300 p-3 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                                />
                                <button onClick={handleApply} className="w-full rounded-lg bg-indigo-500 py-3 font-bold text-white transition-colors hover:bg-indigo-600">
                                    Request to join
                                </button>
                            </>
                        )}
                        <p className="mt-4 text-center text-xs text-gray-400 dark:text-gray-500">
                            By joining you agree your contributions may be published as part of this collaboration's creation, crediting you.
                        </p>
                    </div>
                )}

                {status === 'success' && (
                    <div className="p-8 text-center">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/40">
                            <Icon path={ICONS.checkCircle} className="h-10 w-10 text-green-500" />
                        </div>
                        <h1 className="mb-2 text-2xl font-bold text-gray-800 dark:text-gray-100">You're in!</h1>
                        <p className="mb-6 text-gray-600 dark:text-gray-300">You're a member of {cardTitle}.</p>
                        <button
                            onClick={() => collaborationId && navigate(`/collaboration/${collaborationId}`)}
                            className="w-full rounded-lg bg-indigo-500 py-3 font-bold text-white transition-colors hover:bg-indigo-600"
                        >
                            Open collaboration
                        </button>
                    </div>
                )}

                {status === 'applied' && (
                    <div className="p-8 text-center">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/40">
                            <Icon path={ICONS.checkCircle} className="h-10 w-10 text-yellow-500" />
                        </div>
                        <h1 className="mb-2 text-2xl font-bold text-gray-800 dark:text-gray-100">Application sent</h1>
                        <p className="mb-6 text-gray-600 dark:text-gray-300">An owner of {cardTitle} will review your request. You'll be able to open it once you're approved.</p>
                        <Link to="/communitys" className="block w-full rounded-lg bg-gray-200 py-3 text-center font-bold text-gray-700 transition-colors hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">
                            Go to Community Hub
                        </Link>
                    </div>
                )}

                {status === 'error' && (
                    <div className="p-8 text-center">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-red-100 dark:bg-red-900/40">
                            <Icon path={ICONS.xCircle} className="h-10 w-10 text-red-500" />
                        </div>
                        <h1 className="mb-2 text-2xl font-bold text-gray-800 dark:text-gray-100">Couldn't join</h1>
                        <p className="mb-6 text-gray-600 dark:text-gray-300">{error || 'Something went wrong. Please try again.'}</p>
                        <Link to="/communitys" className="block w-full rounded-lg bg-gray-200 py-3 text-center font-bold text-gray-700 transition-colors hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">
                            Go to Community Hub
                        </Link>
                    </div>
                )}

                {status === 'login_required' && (
                    <div className="p-8 text-center">
                        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-yellow-100 dark:bg-yellow-900/40">
                            <Icon path={ICONS.lockClosed} className="h-10 w-10 text-yellow-500" />
                        </div>
                        <h1 className="mb-2 text-2xl font-bold text-gray-800 dark:text-gray-100">Login required</h1>
                        <p className="mb-6 text-gray-600 dark:text-gray-300">You need to sign in to join this collaboration.</p>
                        <div className="space-y-3">
                            <Link to={`/login?redirect=/collaboration/join/${inviteCode}`} className="block w-full rounded-lg bg-indigo-500 py-3 text-center font-bold text-white transition-colors hover:bg-indigo-600">
                                Sign in
                            </Link>
                            <Link to="/communitys" className="block w-full rounded-lg bg-gray-200 py-3 text-center font-bold text-gray-700 transition-colors hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">
                                Go to Community Hub
                            </Link>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default JoinCollaborationPage;
