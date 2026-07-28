import React, { useState } from 'react';
import PasswordInput from './PasswordInput'; // *** NEW: Import PasswordInput ***

const PasswordConfirmationModal = ({ message, onConfirm, onCancel }) => {
    const [password, setPassword] = useState('');

    const handleConfirm = () => {
        if (password) {
            onConfirm(password);
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-xl text-center max-w-sm w-full">
                <h3 className="text-lg font-bold mb-4">Confirmation Required</h3>
                <p className="mb-4 text-gray-700">{message}</p>
                <div className="mb-6">
                    <label htmlFor="password-confirm" className="block text-sm font-medium text-gray-700 text-left">
                        Please enter your password to confirm
                    </label>
                    {/* *** MODIFIED: Use the new PasswordInput component *** */}
                    <PasswordInput
                        id="password-confirm"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="mt-1 w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm focus:outline-none focus:ring-red-500 focus:border-red-500"
                    />
                </div>
                <div className="flex justify-center space-x-4">
                    <button onClick={onCancel} className="bg-gray-300 hover:bg-gray-400 text-black font-bold py-2 px-6 rounded-lg w-1/2">
                        Cancel
                    </button>
                    <button 
                        onClick={handleConfirm} 
                        disabled={!password}
                        className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-6 rounded-lg w-1/2 disabled:opacity-50"
                    >
                        Confirm
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PasswordConfirmationModal;