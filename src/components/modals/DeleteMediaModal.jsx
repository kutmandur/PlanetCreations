import React from 'react';

const DeleteMediaModal = ({ file, onConfirm, onCancel }) => {
    return (
        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onCancel}>
            <div className="bg-gray-800 text-white rounded-lg shadow-2xl p-6 w-full max-w-xl" onClick={e => e.stopPropagation()}>
                <h2 className="text-xl font-bold mb-2">Delete Media for: {file.name}</h2>
                <p className="text-gray-400 mb-6">Choose your deletion method. This action cannot be undone.</p>
                <div className="space-y-4">
                    <button onClick={() => onConfirm('safe')} className="w-full text-left bg-gray-700 hover:bg-gray-600 p-4 rounded-lg">
                        <h3 className="font-bold text-green-400">Safe Delete (Recommended)</h3>
                        <p className="text-sm text-gray-300">Deletes associated media files that are **NOT** used by any other of your creations.</p>
                    </button>
                    <button onClick={() => onConfirm('force')} className="w-full text-left bg-gray-700 hover:bg-gray-600 p-4 rounded-lg">
                        <h3 className="font-bold text-red-400">Force Delete</h3>
                        <p className="text-sm text-gray-300">Deletes **ALL** associated media files, even if they are used by your other creations. This might break other blueprints.</p>
                    </button>
                </div>
                 <div className="flex justify-end mt-6">
                    <button onClick={onCancel} className="bg-gray-600 hover:bg-gray-500 font-bold py-2 px-6 rounded-lg">Cancel</button>
                </div>
            </div>
        </div>
    );
};

export default DeleteMediaModal;
