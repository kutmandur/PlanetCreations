import React, { useState } from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const DURATION_OPTIONS = [
    { value: 30, label: '30 minutes' },
    { value: 60, label: '1 hour' },
    { value: 120, label: '2 hours' },
    { value: 240, label: '4 hours' },
    { value: 480, label: '8 hours' },
];

const CheckOutModal = ({ file, onConfirm, onCancel }) => {
    const [note, setNote] = useState('');
    const [expectedMinutes, setExpectedMinutes] = useState(60);

    const handleSubmit = (e) => {
        e.preventDefault();
        onConfirm(note, expectedMinutes);
    };

    const formatBytes = (bytes) => {
        if (!bytes) return '0 MB';
        const mb = bytes / (1024 * 1024);
        return mb < 1 ? `${(mb * 1024).toFixed(0)} KB` : `${mb.toFixed(1)} MB`;
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={onCancel}>
            <div
                className="bg-white rounded-xl shadow-2xl max-w-md w-full overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="bg-purple-500 p-6 text-white">
                    <div className="flex items-center justify-between">
                        <h2 className="text-xl font-bold flex items-center gap-2">
                            <Icon path={ICONS.download} className="w-6 h-6" />
                            Download & Edit
                        </h2>
                        <button
                            onClick={onCancel}
                            className="p-1 hover:bg-white/20 rounded-lg transition-colors"
                        >
                            <Icon path={ICONS.xMark} className="w-6 h-6" />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <form onSubmit={handleSubmit} className="p-6 space-y-5">
                    {/* File Info */}
                    <div className="bg-gray-50 rounded-lg p-4 flex items-center gap-3">
                        <span className="text-2xl">
                            {file?.type === '.park2' ? '🎢' : file?.type === '.zoo' ? '🦁' : '📄'}
                        </span>
                        <div>
                            <p className="font-medium text-gray-800">{file?.name}</p>
                            <p className="text-sm text-gray-500">
                                {formatBytes(file?.currentVersion?.sizeBytes)} · v{file?.currentVersion?.number || 1}
                            </p>
                        </div>
                    </div>

                    {/* Mark as editing checkbox */}
                    <div className="flex items-start gap-3 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
                        <Icon path={ICONS.lockClosed} className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="font-medium text-yellow-800">Mark as "In Progress"</p>
                            <p className="text-sm text-yellow-700 mt-1">
                                This lets others know you're editing this file. They'll wait or coordinate with you.
                            </p>
                        </div>
                    </div>

                    {/* Note */}
                    <div>
                        <label htmlFor="note" className="block text-sm font-medium text-gray-700 mb-2">
                            What are you working on? <span className="text-gray-400">(optional)</span>
                        </label>
                        <input
                            type="text"
                            id="note"
                            value={note}
                            onChange={(e) => setNote(e.target.value)}
                            placeholder="e.g., Building the entrance area"
                            maxLength={100}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
                        />
                    </div>

                    {/* Expected Duration */}
                    <div>
                        <label htmlFor="duration" className="block text-sm font-medium text-gray-700 mb-2">
                            Estimated time
                        </label>
                        <select
                            id="duration"
                            value={expectedMinutes}
                            onChange={(e) => setExpectedMinutes(Number(e.target.value))}
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent bg-white"
                        >
                            {DURATION_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>
                                    {option.label}
                                </option>
                            ))}
                        </select>
                        <p className="text-xs text-gray-500 mt-1">
                            Others will see this estimate. It's just a hint, not a hard limit.
                        </p>
                    </div>

                    {/* Buttons */}
                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onCancel}
                            className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="flex-1 py-2 bg-purple-500 hover:bg-purple-600 text-white font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
                        >
                            <Icon path={ICONS.download} className="w-5 h-5" />
                            Download
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default CheckOutModal;
