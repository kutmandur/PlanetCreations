import React, { useState } from 'react';

const DeleteConfirmationModal = ({ item, title, warning, onConfirm, onCancel }) => {
    const [confirmText, setConfirmText] = useState('');
    const canConfirm = confirmText.toLowerCase() === 'delete';

    return (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50" onClick={onCancel}>
            <div className="bg-gray-800 text-white rounded-lg shadow-2xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
                <h2 className="text-xl font-bold text-red-400 mb-4">{title}</h2>
                <p className="mb-4">{warning}</p>
                <input
                    type="text"
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    className="w-full bg-gray-900 border border-gray-600 rounded-md p-2"
                    placeholder='Type "DELETE" to confirm'
                />
                <div className="flex justify-end space-x-4 mt-6">
                    <button onClick={onCancel} className="bg-gray-600 hover:bg-gray-500 font-bold py-2 px-6 rounded-lg">Cancel</button>
                    <button onClick={onConfirm} disabled={!canConfirm} className="bg-red-600 hover:bg-red-700 font-bold py-2 px-6 rounded-lg disabled:opacity-50">Confirm Delete</button>
                </div>
            </div>
        </div>
    );
};

export default DeleteConfirmationModal;