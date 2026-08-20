import React, { useState } from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const InviteMemberModal = ({
    inviteCode,
    accentColor = '#6B7280',
    onClose,
    setModalMessage,
}) => {
    const [copied, setCopied] = useState(null);
    const inviteLink = `planetcreations://collab/join/${inviteCode}`;

    const copyValue = async (value, type) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(type);
            setModalMessage(type === 'code' ? 'Invite code copied.' : 'Desktop invite link copied.');
            window.setTimeout(() => setCopied(null), 1800);
        } catch (error) {
            setModalMessage('Could not copy automatically. Select the value and copy it manually.');
        }
    };

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={onClose}
            role="presentation"
        >
            <div
                className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl dark:bg-gray-800"
                onClick={(event) => event.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="invite-members-title"
            >
                <div className="h-2" style={{ backgroundColor: accentColor }} />
                <div className="p-6 sm:p-7">
                    <div className="flex items-start justify-between gap-4">
                        <div>
                            <p className="text-xs font-bold uppercase tracking-wider" style={{ color: accentColor }}>
                                Add contributors
                            </p>
                            <h2 id="invite-members-title" className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">
                                Share this collaboration
                            </h2>
                            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                                The code works in the Community Hub. The link opens the desktop client directly.
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={onClose}
                            className="rounded-xl p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 dark:hover:bg-gray-700 dark:hover:text-white"
                            aria-label="Close"
                        >
                            <Icon path={ICONS.xMark} className="h-5 w-5" />
                        </button>
                    </div>

                    <div className="mt-6 space-y-5">
                        <section>
                            <label htmlFor="collaboration-invite-code" className="mb-2 block text-sm font-bold text-gray-700 dark:text-gray-200">
                                Invite code
                            </label>
                            <div className="flex gap-2">
                                <input
                                    id="collaboration-invite-code"
                                    readOnly
                                    value={inviteCode}
                                    className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-center font-mono text-xl font-bold tracking-[0.18em] text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
                                    onFocus={(event) => event.target.select()}
                                />
                                <button
                                    type="button"
                                    onClick={() => copyValue(inviteCode, 'code')}
                                    className="flex h-12 w-12 flex-none items-center justify-center rounded-xl text-white transition hover:brightness-95"
                                    style={{ backgroundColor: accentColor }}
                                    aria-label="Copy invite code"
                                >
                                    <Icon path={copied === 'code' ? ICONS.check : ICONS.copy} className="h-5 w-5" />
                                </button>
                            </div>
                        </section>

                        <section>
                            <label htmlFor="collaboration-invite-link" className="mb-2 block text-sm font-bold text-gray-700 dark:text-gray-200">
                                Desktop invite link
                            </label>
                            <div className="flex gap-2">
                                <input
                                    id="collaboration-invite-link"
                                    readOnly
                                    value={inviteLink}
                                    className="min-w-0 flex-1 rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-600 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
                                    onFocus={(event) => event.target.select()}
                                />
                                <button
                                    type="button"
                                    onClick={() => copyValue(inviteLink, 'link')}
                                    className="flex h-12 w-12 flex-none items-center justify-center rounded-xl border border-gray-200 text-gray-600 transition hover:bg-gray-100 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700"
                                    aria-label="Copy desktop invite link"
                                >
                                    <Icon path={copied === 'link' ? ICONS.check : ICONS.copy} className="h-5 w-5" />
                                </button>
                            </div>
                        </section>

                        <div className="rounded-2xl border border-blue-200 bg-blue-50 p-4 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200">
                            <div className="flex gap-3">
                                <Icon path={ICONS.infoCircle} className="mt-0.5 h-5 w-5 flex-none" />
                                <div>
                                    <p className="font-bold">One save, one active builder</p>
                                    <p className="mt-1 text-blue-700 dark:text-blue-300">
                                        Contributors join here, then use the In-Game Overlay to start and hand off build sessions safely.
                                    </p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={onClose}
                        className="mt-6 w-full rounded-xl bg-gray-100 px-5 py-3 font-bold text-gray-800 transition hover:bg-gray-200 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600"
                    >
                        Done
                    </button>
                </div>
            </div>
        </div>
    );
};

export default InviteMemberModal;
