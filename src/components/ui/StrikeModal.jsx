import React, { useState } from 'react';

const StrikeModal = ({ onConfirm, onCancel }) => {
    const [reason, setReason] = useState('');

    const handleConfirm = () => {
        if (reason.trim()) {
            onConfirm(reason);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-xl max-w-md w-full">
                <h3 className="text-xl font-bold mb-4">Issue a Strike</h3>
                <p className="text-gray-600 mb-4">Please provide a reason for this strike. The user will be notified.</p>
                <div>
                    <label htmlFor="strike-reason" className="block text-sm font-medium text-gray-700 mb-1">Reason for Strike</label>
                    <textarea
                        id="strike-reason"
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows="4"
                        className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-yellow-500 focus:border-yellow-500"
                        placeholder="e.g., Violation of community guidelines regarding spam."
                    />
                </div>
                <div className="flex justify-end space-x-4 mt-6">
                    <button onClick={onCancel} className="bg-gray-300 hover:bg-gray-400 text-black font-bold py-2 px-6 rounded-lg">
                        Cancel
                    </button>
                    <button 
                        onClick={handleConfirm} 
                        disabled={!reason.trim()}
                        className="bg-yellow-500 hover:bg-yellow-600 text-white font-bold py-2 px-6 rounded-lg disabled:opacity-50"
                    >
                        Issue Strike
                    </button>
                </div>
            </div>
        </div>
    );
};

export default StrikeModal;
