import React, { useState } from 'react';
import { db } from '../../firebase/config';
import { collection, addDoc, serverTimestamp } from 'firebase/firestore';
import Spinner from '../ui/Spinner';

// Bug-Report für eingeloggte Nutzer (Footer-Link). Speichert neben der
// Beschreibung automatisch technischen Kontext (Seite, Browser, Auflösung),
// damit sich Fehler später leichter nachvollziehen lassen.
const BugReportModal = ({ user, userProfile, onClose, setModalMessage, blacklist }) => {
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleSubmit = async () => {
        const trimmed = description.trim();
        if (trimmed.length < 10) {
            setModalMessage('Please describe the bug in a bit more detail (at least 10 characters).');
            return;
        }
        const foundWord = (blacklist || []).find(word => trimmed.toLowerCase().includes(word.toLowerCase()));
        if (foundWord) {
            setModalMessage(`Your report contains a forbidden word: "${foundWord}"`);
            return;
        }

        setIsSubmitting(true);
        try {
            await addDoc(collection(db, 'bugReports'), {
                description: trimmed,
                page: window.location.hash || window.location.pathname,
                userId: user.uid,
                username: userProfile?.username || user.email || 'Unknown',
                userAgent: navigator.userAgent,
                screen: `${window.innerWidth}x${window.innerHeight}`,
                status: 'open',
                createdAt: serverTimestamp(),
                closedAt: null,
            });
            setModalMessage('Thank you! Your bug report has been submitted.');
            onClose();
        } catch (error) {
            setModalMessage(`Error submitting bug report: ${error.message}`);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg p-6" onClick={(e) => e.stopPropagation()}>
                <h2 className="text-xl font-bold text-gray-800 mb-2">Report a Bug</h2>
                <p className="text-sm text-gray-500 mb-4">
                    Describe what went wrong, what you expected to happen, and how to reproduce it.
                </p>
                <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What happened? What did you expect? Steps to reproduce..."
                    rows={6}
                    maxLength={3000}
                    className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
                    autoFocus
                />
                <p className="text-xs text-gray-400 mt-2">
                    The current page, your browser version and screen size are sent along automatically to help with troubleshooting.
                </p>
                <div className="flex justify-end gap-2 mt-4">
                    <button onClick={onClose} className="py-2 px-4 rounded-lg bg-gray-200 text-gray-700 hover:bg-gray-300 font-semibold">
                        Cancel
                    </button>
                    <button
                        onClick={handleSubmit}
                        disabled={isSubmitting || description.trim().length === 0}
                        className="py-2 px-6 rounded-lg bg-blue-500 hover:bg-blue-600 text-white font-semibold disabled:opacity-50"
                    >
                        {isSubmitting ? <Spinner size="small" /> : 'Submit Report'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BugReportModal;
