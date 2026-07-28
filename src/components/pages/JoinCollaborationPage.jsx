import React, { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
    applyToCollaboration,
    getCollaborationJoinInfo,
    joinCollaborationByCode,
    joinCollaborationByPassword,
} from '../../firebase/collaboration';
import { getGameColor, ICONS } from '../../utils/helpers';
import { getGame } from '../../utils/gamesRegistry';
import Icon from '../ui/Icon';
import Spinner from '../ui/Spinner';

const ACCESS_COPY = {
    invite: {
        label: 'Invite only',
        title: "You've been invited",
        detail: 'This team shared a private join link with you.',
        icon: ICONS.envelope,
    },
    password: {
        label: 'Password',
        title: 'Enter the team password',
        detail: 'Use the password shared by a collaboration member.',
        icon: ICONS.lockClosed,
    },
    application: {
        label: 'Application',
        title: 'Request to join',
        detail: 'Tell the owners briefly how you would like to contribute.',
        icon: ICONS.userPlus,
    },
};

const JoinCollaborationPage = ({ user, setModalMessage }) => {
    const { inviteCode } = useParams();
    const navigate = useNavigate();
    const [status, setStatus] = useState('loading');
    const [error, setError] = useState('');
    const [info, setInfo] = useState(null);
    const [collaborationId, setCollaborationId] = useState(null);
    const [password, setPassword] = useState('');
    const [message, setMessage] = useState('');
    const gameColor = getGameColor(info?.game || 'default');
    const game = getGame(info?.game);
    const access = ACCESS_COPY[info?.joinMode] || ACCESS_COPY.invite;

    useEffect(() => {
        if (!inviteCode) {
            setStatus('error');
            setError('No invite code provided.');
            return undefined;
        }
        if (!user) {
            setStatus('login_required');
            return undefined;
        }
        let mounted = true;
        getCollaborationJoinInfo(inviteCode)
            .then((joinInfo) => {
                if (!mounted) return;
                setInfo(joinInfo);
                setCollaborationId(joinInfo.collaborationId);
                if (joinInfo.alreadyMember) setStatus('success');
                else if (joinInfo.joinMode === 'application' && joinInfo.applicationStatus === 'pending') setStatus('applied');
                else setStatus('ready');
            })
            .catch((joinError) => {
                if (!mounted) return;
                setStatus('error');
                setError(joinError.message);
            });
        return () => { mounted = false; };
    }, [inviteCode, user]);

    const handleJoinInvite = useCallback(async () => {
        setStatus('joining');
        try {
            const id = await joinCollaborationByCode(user.uid, inviteCode);
            setCollaborationId(id);
            setStatus('success');
        } catch (joinError) {
            setModalMessage(joinError.message);
            setStatus('ready');
        }
    }, [inviteCode, setModalMessage, user]);

    const handleJoinPassword = useCallback(async (event) => {
        event?.preventDefault();
        if (password.trim().length < 4) {
            setModalMessage('Please enter the join password.');
            return;
        }
        setStatus('joining');
        try {
            const id = await joinCollaborationByPassword(inviteCode, password.trim());
            setCollaborationId(id);
            setStatus('success');
        } catch (joinError) {
            setModalMessage(joinError.message);
            setStatus('ready');
        }
    }, [inviteCode, password, setModalMessage]);

    const handleApply = useCallback(async (event) => {
        event?.preventDefault();
        setStatus('joining');
        try {
            await applyToCollaboration(inviteCode, message.trim());
            setStatus('applied');
        } catch (joinError) {
            setModalMessage(joinError.message);
            setStatus('ready');
        }
    }, [inviteCode, message, setModalMessage]);

    const renderState = () => {
        if (status === 'loading' || status === 'joining') {
            return (
                <div className="px-6 py-16 text-center">
                    <Spinner />
                    <p className="mt-4 font-semibold text-gray-600 dark:text-gray-300">
                        {status === 'joining' ? 'Joining collaboration…' : 'Checking invite…'}
                    </p>
                </div>
            );
        }

        if (status === 'success') {
            return (
                <div className="px-6 py-10 text-center sm:px-9">
                    <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-100 dark:bg-emerald-900/40">
                        <Icon path={ICONS.checkCircle} className="h-9 w-9 text-emerald-600 dark:text-emerald-300" />
                    </span>
                    <h2 className="mt-5 text-2xl font-bold text-gray-900 dark:text-gray-100">You're on the team</h2>
                    <p className="mt-2 text-gray-600 dark:text-gray-300">
                        Open {info?.title || 'the collaboration'} to see its build status, tasks and shared save.
                    </p>
                    <button
                        type="button"
                        onClick={() => collaborationId && navigate(`/collaboration/${collaborationId}`)}
                        className="mt-7 w-full rounded-xl py-3 font-bold text-white transition hover:brightness-110"
                        style={{ backgroundColor: gameColor.hex }}
                    >
                        Open collaboration
                    </button>
                </div>
            );
        }

        if (status === 'applied') {
            return (
                <div className="px-6 py-10 text-center sm:px-9">
                    <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/40">
                        <Icon path={ICONS.clock} className="h-9 w-9 text-amber-600 dark:text-amber-300" />
                    </span>
                    <h2 className="mt-5 text-2xl font-bold text-gray-900 dark:text-gray-100">Request sent</h2>
                    <p className="mt-2 text-gray-600 dark:text-gray-300">
                        An owner will review your application. You can open the project once it is approved.
                    </p>
                    <Link to="/communitys" className="mt-7 block w-full rounded-xl bg-gray-100 py-3 text-center font-bold text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">
                        Back to Community Hub
                    </Link>
                </div>
            );
        }

        if (status === 'login_required') {
            return (
                <div className="px-6 py-10 text-center sm:px-9">
                    <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-100 dark:bg-amber-900/40">
                        <Icon path={ICONS.lockClosed} className="h-9 w-9 text-amber-600 dark:text-amber-300" />
                    </span>
                    <h2 className="mt-5 text-2xl font-bold text-gray-900 dark:text-gray-100">Sign in to continue</h2>
                    <p className="mt-2 text-gray-600 dark:text-gray-300">
                        Collaboration links are private and can only be resolved for signed-in users.
                    </p>
                    <div className="mt-7 space-y-3">
                        <Link to={`/login?redirect=/collaboration/join/${inviteCode}`} className="block w-full rounded-xl bg-blue-600 py-3 text-center font-bold text-white hover:bg-blue-700">
                            Sign in
                        </Link>
                        <Link to="/communitys" className="block w-full rounded-xl bg-gray-100 py-3 text-center font-bold text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">
                            Back to Community Hub
                        </Link>
                    </div>
                </div>
            );
        }

        if (status === 'error') {
            return (
                <div className="px-6 py-10 text-center sm:px-9">
                    <span className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-red-100 dark:bg-red-900/40">
                        <Icon path={ICONS.xCircle} className="h-9 w-9 text-red-600 dark:text-red-300" />
                    </span>
                    <h2 className="mt-5 text-2xl font-bold text-gray-900 dark:text-gray-100">Invite unavailable</h2>
                    <p className="mt-2 text-gray-600 dark:text-gray-300">{error || 'The link may be invalid or expired.'}</p>
                    <Link to="/communitys" className="mt-7 block w-full rounded-xl bg-gray-100 py-3 text-center font-bold text-gray-700 hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-200 dark:hover:bg-gray-600">
                        Back to Community Hub
                    </Link>
                </div>
            );
        }

        return (
            <div className="px-6 py-7 sm:px-9 sm:py-9">
                <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl text-white" style={{ backgroundColor: gameColor.hex }}>
                        <Icon path={access.icon} className="h-5 w-5" />
                    </span>
                    <div>
                        <p className="text-sm font-bold" style={{ color: gameColor.hex }}>{access.label}</p>
                        <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{access.title}</h2>
                        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{access.detail}</p>
                    </div>
                </div>

                {info.joinMode === 'invite' && (
                    <button type="button" onClick={handleJoinInvite} className="mt-6 w-full rounded-xl py-3 font-bold text-white transition hover:brightness-110" style={{ backgroundColor: gameColor.hex }}>
                        Accept invitation
                    </button>
                )}

                {info.joinMode === 'password' && (
                    <form onSubmit={handleJoinPassword} className="mt-6 space-y-3">
                        <label htmlFor="collaboration-password" className="block font-bold text-gray-800 dark:text-gray-200">Join password</label>
                        <input
                            id="collaboration-password"
                            type="password"
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            autoComplete="current-password"
                            className="w-full rounded-xl border border-gray-300 bg-white p-3 text-gray-900 focus:outline-none focus:ring-2 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                            style={{ '--tw-ring-color': gameColor.hex }}
                        />
                        <button type="submit" className="w-full rounded-xl py-3 font-bold text-white transition hover:brightness-110" style={{ backgroundColor: gameColor.hex }}>
                            Join collaboration
                        </button>
                    </form>
                )}

                {info.joinMode === 'application' && (
                    <form onSubmit={handleApply} className="mt-6 space-y-3">
                        <label htmlFor="collaboration-application" className="block font-bold text-gray-800 dark:text-gray-200">
                            Message <span className="font-normal text-gray-400">(optional)</span>
                        </label>
                        <textarea
                            id="collaboration-application"
                            value={message}
                            onChange={(event) => setMessage(event.target.value)}
                            rows={4}
                            maxLength={300}
                            placeholder="What would you like to work on?"
                            className="w-full resize-none rounded-xl border border-gray-300 bg-white p-3 text-gray-900 focus:outline-none focus:ring-2 dark:border-gray-600 dark:bg-gray-900 dark:text-gray-100"
                            style={{ '--tw-ring-color': gameColor.hex }}
                        />
                        <p className="text-right text-xs text-gray-400">{message.length}/300</p>
                        <button type="submit" className="w-full rounded-xl py-3 font-bold text-white transition hover:brightness-110" style={{ backgroundColor: gameColor.hex }}>
                            Send request
                        </button>
                    </form>
                )}

                <div className="mt-6 flex gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs leading-5 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
                    <Icon path={ICONS.infoCircle} className="mt-0.5 h-4 w-4 flex-none" />
                    <p>
                        By joining, you agree that your contributions may be published with this creation while keeping your contributor credit.
                    </p>
                </div>
            </div>
        );
    };

    return (
        <div className="flex min-h-full items-center justify-center bg-gray-100 px-4 py-10 dark:bg-gray-900" style={gameColor.style}>
            <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-gray-200 dark:bg-gray-800 dark:ring-gray-700">
                <div className="h-2" style={{ backgroundColor: gameColor.hex }} />
                {info && status !== 'loading' && status !== 'joining' && (
                    <header className="border-b border-gray-200 px-6 py-5 dark:border-gray-700 sm:px-9">
                        <div className="flex flex-wrap items-center gap-2">
                            {game && (
                                <span className="rounded-full px-2.5 py-1 text-xs font-bold text-white" style={{ backgroundColor: gameColor.hex }}>
                                    {game.shortName}
                                </span>
                            )}
                            <span className="rounded-full bg-gray-100 px-2.5 py-1 text-xs font-semibold capitalize text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                                {info.joinMode}
                            </span>
                            {Number.isFinite(info.memberCount) && (
                                <span className="text-xs text-gray-400">{info.memberCount} members</span>
                            )}
                        </div>
                        <h1 className="mt-3 break-words text-2xl font-bold text-gray-900 dark:text-gray-100">{info.title}</h1>
                        {info.description && <p className="mt-2 line-clamp-3 text-sm text-gray-600 dark:text-gray-300">{info.description}</p>}
                    </header>
                )}
                {renderState()}
            </div>
        </div>
    );
};

export default JoinCollaborationPage;
