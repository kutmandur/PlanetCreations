import {getFunctions, httpsCallable} from 'firebase/functions';
import React, { useState, useMemo } from 'react';
import Spinner from '../ui/Spinner';

const Highlight = ({ text, highlight }) => {
    if (!highlight) {
        return <span>{text}</span>;
    }
    const lowerText = text.toLowerCase();
    const lowerHighlight = highlight.toLowerCase();
    const index = lowerText.indexOf(lowerHighlight);
    if (index === -1) {
        return <span>{text}</span>;
    }
    const before = text.slice(0, index);
    const match = text.slice(index, index + highlight.length);
    const after = text.slice(index + highlight.length);
    return (
        <span>
            {before}
            <strong className="bg-yellow-200 rounded">{match}</strong>
            {after}
        </span>
    );
};

const BlacklistManager = ({ blacklist, setModalMessage }) => {
    const [newWord, setNewWord] = useState('');
    const [loading, setLoading] = useState(false);

    const handleAddWord = async () => {
        const wordToAdd = newWord.trim().toLowerCase();
        if (!wordToAdd) return;

        if (blacklist.includes(wordToAdd)) {
            setModalMessage(`"${wordToAdd}" is already on the blacklist.`);
            return;
        }

        setLoading(true);
        try {
            await httpsCallable(getFunctions(), 'updateContentPolicy')({action:'add',word:wordToAdd});
            setNewWord('');
        } catch (error) {
            setModalMessage(`Error adding word: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteWord = async (wordToDelete) => {
        setLoading(true);
        try {
            await httpsCallable(getFunctions(), 'updateContentPolicy')({action:'remove',word:wordToDelete});
        } catch (error) {
            setModalMessage(`Error deleting word: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const filteredBlacklist = useMemo(() =>
        blacklist.filter(word =>
            word.toLowerCase().includes(newWord.toLowerCase())
        ).sort(),
    [blacklist, newWord]);

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold mb-4">Manage Blacklist</h2>
            <p className="mb-3 text-sm">Terms are checked on the server and in Firestore rules. Draft text is kept for correction. Review terms carefully to avoid blocking ordinary game descriptions.</p>
            <button className="mb-4 underline" disabled={loading} onClick={async()=>{setLoading(true);try{await httpsCallable(getFunctions(),'updateContentPolicy')({action:'publish'});setModalMessage('Current text policy published.');}catch(error){setModalMessage(error.message);}finally{setLoading(false);}}}>Publish current terms to the shared policy</button>
            <div className="flex space-x-2 mb-4">
                <input
                    type="text"
                    value={newWord}
                    onChange={(e) => setNewWord(e.target.value)}
                    placeholder="Add or search for a word..."
                    className="flex-grow p-2 border rounded-lg"
                />
                <button
                    onClick={handleAddWord}
                    disabled={loading || !newWord.trim()}
                    className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50"
                >
                    {loading ? <Spinner size="small" /> : 'Add Word'}
                </button>
            </div>

            <div>
                <h3 className="font-bold mb-2">Current Blacklisted Words:</h3>
                {filteredBlacklist.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                        {filteredBlacklist.map(word => (
                            <div key={word} className="flex items-center bg-gray-200 text-gray-800 text-sm font-medium px-3 py-1 rounded-full">
                                <Highlight text={word} highlight={newWord} />
                                <button 
                                    onClick={() => handleDeleteWord(word)}
                                    className="ml-2 text-red-500 hover:text-red-700 font-bold"
                                >
                                    &times;
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-gray-500">
                        {blacklist.length > 0 ? 'No matching words found.' : 'No custom terms configured. The standard safety terms remain active.'}
                    </p>
                )}
            </div>
        </div>
    );
};

export default BlacklistManager;
