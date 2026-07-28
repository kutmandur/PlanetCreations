import React, { useState } from 'react';
import ToggleSwitch from '../ui/ToggleSwitch';

const BackupNoteModal = ({ onConfirm, onCancel, isOnline }) => {
    const [note, setNote] = useState('');
    const [isSigned, setIsSigned] = useState(false);

    const handleConfirm = () => {
        onConfirm(note, isSigned);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-[100]" onClick={onCancel}>
            <div className="bg-gray-800 text-white rounded-lg shadow-2xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
                <h2 className="text-xl font-bold mb-4">Add a Note to Your Backup</h2>
                <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-600 rounded-md p-2 h-24"
                    placeholder="Optional: Describe this backup..."
                />
                <div className={`mt-4 p-3 rounded-lg ${isOnline ? 'bg-gray-700' : 'bg-gray-900 opacity-50'}`}>
                    <div className="flex items-center justify-between">
                        <div>
                            <h3 className={`font-semibold ${isOnline ? 'text-white' : 'text-gray-500'}`}>Sign Backup for Sharing</h3>
                            <p className={`text-sm ${isOnline ? 'text-gray-400' : 'text-gray-600'}`}>
                                {isOnline ? "Requires an internet connection." : "Go online to enable signing."}
                            </p>
                        </div>
                        <ToggleSwitch 
                            isToggled={isSigned} 
                            onToggle={() => setIsSigned(!isSigned)} 
                            disabled={!isOnline}
                        />
                    </div>
                </div>
                <div className="flex justify-end space-x-4 mt-6">
                    <button onClick={onCancel} className="bg-gray-600 hover:bg-gray-500 font-bold py-2 px-6 rounded-lg">Cancel</button>
                    <button onClick={handleConfirm} className="bg-blue-600 hover:bg-blue-700 font-bold py-2 px-6 rounded-lg">Confirm Backup</button>
                </div>
            </div>
        </div>
    );
};

export default BackupNoteModal;