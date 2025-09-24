import React, { useState } from 'react';
import { containsBlacklistedWord } from '../../utils/helpers';
import HighlightableTextarea from '../ui/HighlightableTextarea';

const ShowcaseNoteModal = ({ onConfirm, onCancel, blacklist }) => {
    const [note, setNote] = useState('');
    const [error, setError] = useState('');

    const handleConfirm = () => {
        if (containsBlacklistedWord(note, blacklist)) {
            setError('The note contains a forbidden word. Please revise it.');
            return;
        }
        setError('');
        onConfirm(note);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-xl max-w-md w-full">
                <h3 className="text-xl font-bold mb-4">Mark for Showcase</h3>
                <p className="text-gray-600 mb-4">Add an optional note for this showcase item. This can be used for internal planning.</p>
                <div>
                    <label htmlFor="showcase-note" className="block text-sm font-medium text-gray-700 mb-1">
                        Showcase Note (Optional)
                    </label>
                    <HighlightableTextarea
                        id="showcase-note"
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows="4"
                        blacklist={blacklist}
                        className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-blue-500 focus:border-blue-500"
                        placeholder="e.g., Use for the weekly community highlight..."
                    />
                    {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
                </div>
                <div className="flex justify-end space-x-4 mt-6">
                    <button onClick={onCancel} className="bg-gray-300 hover:bg-gray-400 text-black font-bold py-2 px-6 rounded-lg">
                        Cancel
                    </button>
                    <button 
                        onClick={handleConfirm}
                        className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-lg"
                    >
                        Mark for Showcase
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ShowcaseNoteModal;