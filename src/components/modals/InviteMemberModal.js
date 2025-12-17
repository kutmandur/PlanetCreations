import React from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const InviteMemberModal = ({ inviteCode, onClose, setModalMessage }) => {
    const inviteLink = `planetcreations://collab/join/${inviteCode}`;

    const handleCopyCode = () => {
        navigator.clipboard.writeText(inviteCode);
        setModalMessage('Invite code copied!');
    };

    const handleCopyLink = () => {
        navigator.clipboard.writeText(inviteLink);
        setModalMessage('Invite link copied!');
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div
                className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-purple-500 p-6 text-white">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <Icon path={ICONS.share} className="w-6 h-6" />
                            Invite Members
                        </h2>
                        <button
                            onClick={onClose}
                            className="p-1 hover:bg-white/20 rounded-lg transition-colors"
                        >
                            <Icon path={ICONS.xMark} className="w-6 h-6" />
                        </button>
                    </div>
                    <p className="text-white/80 mt-2 text-sm">
                        Share the code or link with people you want to invite
                    </p>
                </div>

                {/* Content */}
                <div className="p-6 space-y-6">
                    {/* Invite Code */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Invite Code
                        </label>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 bg-gray-100 px-4 py-3 rounded-lg font-mono text-xl tracking-wider text-center">
                                {inviteCode}
                            </code>
                            <button
                                onClick={handleCopyCode}
                                className="p-3 bg-purple-100 hover:bg-purple-200 text-purple-600 rounded-lg transition-colors"
                                title="Copy code"
                            >
                                <Icon path={ICONS.copy} className="w-5 h-5" />
                            </button>
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="flex items-center">
                        <div className="flex-1 border-t border-gray-200" />
                        <span className="px-3 text-sm text-gray-500">or</span>
                        <div className="flex-1 border-t border-gray-200" />
                    </div>

                    {/* Invite Link (Desktop Client) */}
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                            Direct Link <span className="text-gray-400">(Desktop Client)</span>
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="text"
                                value={inviteLink}
                                readOnly
                                className="flex-1 bg-gray-100 px-4 py-2 rounded-lg text-sm text-gray-600 truncate"
                            />
                            <button
                                onClick={handleCopyLink}
                                className="p-2 bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg transition-colors"
                                title="Copy link"
                            >
                                <Icon path={ICONS.copy} className="w-5 h-5" />
                            </button>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">
                            This link opens directly in the PlanetCreations client
                        </p>
                    </div>

                    {/* Info */}
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <div className="flex gap-3">
                            <Icon path={ICONS.infoCircle} className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
                            <div className="text-sm text-blue-700">
                                <p className="font-medium mb-1">How to join:</p>
                                <ol className="list-decimal list-inside space-y-1 text-blue-600">
                                    <li>Open the PlanetCreations client</li>
                                    <li>Go to Community Hub → Collaborations</li>
                                    <li>Click "Join with Code" and enter the code</li>
                                </ol>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="px-6 pb-6">
                    <button
                        onClick={onClose}
                        className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};

export default InviteMemberModal;
