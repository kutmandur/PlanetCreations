import React, { useState } from 'react';

const BackupNoteModal = ({ onConfirm, onCancel }) => {
    const [note, setNote] = useState('');

    const handleConfirm = () => {
        onConfirm(note);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50">
            <div className="bg-gray-800 p-6 rounded-lg shadow-xl max-w-md w-full border border-gray-700">
                <h3 className="text-xl font-bold mb-4 text-white">Add Backup Note</h3>
                <p className="text-gray-400 mb-4 text-sm">You can add an optional note to remember why you created this backup (e.g., "Before big coaster build").</p>
                <div>
                    <label htmlFor="backup-note" className="block text-sm font-medium text-gray-300 mb-1">
                        Backup Note (Optional)
                    </label>
                    <textarea
                        id="backup-note"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows="3"
                        className="w-full p-2 bg-gray-700 border border-gray-600 rounded-md text-white focus:ring-blue-500 focus:border-blue-500"
                        placeholder="Enter your note here..."
                    />
                </div>
                <div className="flex justify-end space-x-4 mt-6">
                    <button onClick={onCancel} className="bg-gray-600 hover:bg-gray-500 text-white font-bold py-2 px-6 rounded-lg">
                        Cancel
                    </button>
                    <button 
                        onClick={handleConfirm}
                        className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-lg"
                    >
                        Save Backup
                    </button>
                </div>
            </div>
        </div>
    );
};

export default BackupNoteModal;