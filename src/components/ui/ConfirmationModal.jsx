import React from 'react';

const ConfirmationModal = ({ message, onConfirm, onCancel }) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
        <div className="bg-white dark:bg-gray-800 dark:text-gray-100 p-8 rounded-lg shadow-xl text-center max-w-sm">
            <p className="mb-6 text-lg">{message}</p>
            <div className="flex justify-center space-x-4">
                <button onClick={onCancel} className="bg-gray-300 hover:bg-gray-400 dark:bg-gray-600 dark:hover:bg-gray-500 text-black dark:text-white font-bold py-2 px-6 rounded-lg w-1/2">
                    Cancel
                </button>
                <button onClick={onConfirm} className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-6 rounded-lg w-1/2">
                    Confirm
                </button>
            </div>
        </div>
    </div>
);

export default ConfirmationModal;