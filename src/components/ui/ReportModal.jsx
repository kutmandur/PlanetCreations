import React, { useState } from 'react';
import { containsBlacklistedWord } from '../../utils/helpers';

const ReportModal = ({ targetType, onConfirm, onCancel, blacklist = [] }) => {
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');

    const handleConfirm = () => {
        if (containsBlacklistedWord(reason, blacklist)) {
            setError('Your report contains a forbidden word. Please revise it.');
            return;
        }
        if (reason.trim()) {
            setError('');
            onConfirm(reason);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-xl max-w-md w-full">
                <h3 className="text-xl font-bold mb-4">Report {targetType}</h3>
                <p className="text-gray-600 mb-4">Please provide a reason for your report. This will be reviewed by our moderation team.</p>
                <div>
                    <label htmlFor="report-reason" className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                    <textarea
                        id="report-reason"
                        value={reason}
                        onChange={(e) => { setReason(e.target.value); setError(''); }}
                        rows="4"
                        maxLength={2000}
                        className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500"
                        placeholder={`Why are you reporting this ${targetType}?`}
                    />
                    {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
                </div>
                <div className="flex justify-end space-x-4 mt-6">
                    <button onClick={onCancel} className="bg-gray-300 hover:bg-gray-400 text-black font-bold py-2 px-6 rounded-lg">
                        Cancel
                    </button>
                    <button 
                        onClick={handleConfirm} 
                        disabled={!reason.trim()}
                        className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-6 rounded-lg disabled:opacity-50"
                    >
                        Submit Report
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ReportModal;
