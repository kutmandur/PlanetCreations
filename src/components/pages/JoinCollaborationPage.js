import React, { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { joinCollaborationByCode } from '../../firebase/collaboration';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const JoinCollaborationPage = ({ user, setModalMessage }) => {
    const { inviteCode } = useParams();
    const navigate = useNavigate();
    const [status, setStatus] = useState('loading'); // 'loading', 'success', 'error', 'login_required'
    const [error, setError] = useState('');
    const [collaborationId, setCollaborationId] = useState(null);

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

        const joinCollaboration = async () => {
            try {
                const id = await joinCollaborationByCode(user.uid, inviteCode);
                setCollaborationId(id);
                setStatus('success');
            } catch (err) {
                setStatus('error');
                setError(err.message);
            }
        };

        joinCollaboration();
    }, [inviteCode, user]);

    const handleGoToCollaboration = () => {
        if (collaborationId) {
            navigate(`/collaboration/${collaborationId}`);
        }
    };

    return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-gray-100">
            <div className="max-w-md w-full bg-white rounded-xl shadow-lg overflow-hidden">
                {status === 'loading' && (
                    <div className="p-8 text-center">
                        <Spinner />
                        <p className="mt-4 text-gray-600">Joining collaboration...</p>
                    </div>
                )}

                {status === 'success' && (
                    <div className="p-8 text-center">
                        <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Icon path={ICONS.checkCircle} className="w-10 h-10 text-green-500" />
                        </div>
                        <h1 className="text-2xl font-bold text-gray-800 mb-2">
                            You're In!
                        </h1>
                        <p className="text-gray-600 mb-6">
                            You've successfully joined the collaboration.
                        </p>
                        <button
                            onClick={handleGoToCollaboration}
                            className="w-full py-3 bg-purple-500 hover:bg-purple-600 text-white font-bold rounded-lg transition-colors"
                        >
                            Open Collaboration
                        </button>
                    </div>
                )}

                {status === 'error' && (
                    <div className="p-8 text-center">
                        <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Icon path={ICONS.xCircle} className="w-10 h-10 text-red-500" />
                        </div>
                        <h1 className="text-2xl font-bold text-gray-800 mb-2">
                            Couldn't Join
                        </h1>
                        <p className="text-gray-600 mb-6">
                            {error || 'Something went wrong. Please try again.'}
                        </p>
                        <Link
                            to="/communitys"
                            className="block w-full py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg transition-colors text-center"
                        >
                            Go to Community Hub
                        </Link>
                    </div>
                )}

                {status === 'login_required' && (
                    <div className="p-8 text-center">
                        <div className="w-16 h-16 bg-yellow-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <Icon path={ICONS.lockClosed} className="w-10 h-10 text-yellow-500" />
                        </div>
                        <h1 className="text-2xl font-bold text-gray-800 mb-2">
                            Login Required
                        </h1>
                        <p className="text-gray-600 mb-6">
                            You need to sign in to join this collaboration.
                        </p>
                        <div className="space-y-3">
                            <Link
                                to={`/login?redirect=/collaboration/join/${inviteCode}`}
                                className="block w-full py-3 bg-purple-500 hover:bg-purple-600 text-white font-bold rounded-lg transition-colors text-center"
                            >
                                Sign In
                            </Link>
                            <Link
                                to="/communitys"
                                className="block w-full py-3 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg transition-colors text-center"
                            >
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
