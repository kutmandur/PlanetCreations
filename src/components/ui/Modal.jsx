import React, { useState } from 'react';
import { getGameColor } from '../../utils/helpers';

const Modal = ({ message, onClose, activeTab }) => {
    const color = getGameColor(activeTab);
    const content = typeof message === 'string' ? { message } : message;
    const isDismissible = content?.dismissible !== false;
    const showProgress = Boolean(content?.progress);
    const [actionPending, setActionPending] = useState(false);

    const handleAction = async () => {
        if (actionPending || typeof content?.onAction !== 'function') return;
        setActionPending(true);
        try {
            await content.onAction();
        } finally {
            setActionPending(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" style={color.style}>
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby={content?.title ? 'notice-modal-title' : undefined}
                aria-describedby="notice-modal-message"
                className="w-full max-w-sm rounded-2xl bg-white p-8 text-center shadow-xl dark:bg-gray-800 dark:text-gray-100"
            >
                {content?.title && (
                    <h2 id="notice-modal-title" className="mb-2 text-xl font-bold">
                        {content.title}
                    </h2>
                )}
                <p id="notice-modal-message" className={showProgress || content?.detail ? 'text-base' : 'mb-6 text-lg'}>
                    {content?.message}
                </p>
                {content?.detail && (
                    <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                        {content.detail}
                    </p>
                )}
                {showProgress && (
                    <div
                        role="progressbar"
                        aria-label={content?.progressLabel || 'Processing'}
                        className="mt-6 h-2.5 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
                    >
                        <div className={`pc-modal-progress-bar h-full rounded-full ${color.bg}`} />
                    </div>
                )}
                {content?.actionLabel && (
                    <button
                        type="button"
                        onClick={handleAction}
                        disabled={actionPending}
                        className={`${color.bg} ${color.hoverBg} mt-6 w-full rounded-lg px-6 py-2 font-bold text-white disabled:cursor-wait disabled:opacity-60`}
                    >
                        {actionPending
                            ? (content.actionPendingLabel || content.actionLabel)
                            : content.actionLabel}
                    </button>
                )}
                {isDismissible && (
                    <button onClick={onClose} className={`${content?.actionLabel ? 'mt-3 bg-gray-200 text-gray-800 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-100 dark:hover:bg-gray-600' : `${color.bg} ${color.hoverBg} mt-6 text-white`} w-full rounded-lg px-6 py-2 font-bold`}>
                        OK
                    </button>
                )}
            </div>
        </div>
    );
};

export default Modal;
