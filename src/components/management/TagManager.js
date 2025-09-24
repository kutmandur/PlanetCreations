import React, { useState, useMemo } from 'react';
import { doc, setDoc, deleteDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
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

const TagManager = ({ tags, setModalMessage }) => {
    const [newTag, setNewTag] = useState('');
    const [loading, setLoading] = useState(false);

    const handleAddTag = async () => {
        const tagToAdd = newTag.trim().toLowerCase();
        if (!tagToAdd) return;

        // ✅ FIX: Check against the .id property of the tag objects
        if (tags.some(tag => tag.id === tagToAdd)) {
            setModalMessage(`"${tagToAdd}" already exists in the tag library.`);
            return;
        }

        setLoading(true);
        const tagRef = doc(db, 'tags', tagToAdd);
        try {
            await setDoc(tagRef, { count: 1 });
            setNewTag('');
        } catch (error) {
            setModalMessage(`Error adding tag: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteTag = async (tagIdToDelete) => {
        setLoading(true);
        const tagRef = doc(db, 'tags', tagIdToDelete);
        try {
            await deleteDoc(tagRef);
        } catch (error) {
            setModalMessage(`Error deleting tag: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    const filteredTags = useMemo(() =>
        // ✅ FIX: Filter based on the tag's .id property
        tags.filter(tag =>
            tag.id.toLowerCase().includes(newTag.toLowerCase())
        ).sort((a, b) => a.id.localeCompare(b.id)),
    [tags, newTag]);

    return (
        <div className="bg-white p-6 rounded-lg shadow-md">
            <h2 className="text-2xl font-bold mb-4">Manage Tag Library</h2>
            <div className="flex space-x-2 mb-4">
                <input
                    type="text"
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    placeholder="Add or search for a tag..."
                    className="flex-grow p-2 border rounded-lg"
                />
                <button
                    onClick={handleAddTag}
                    disabled={loading || !newTag.trim()}
                    className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50"
                >
                    {loading ? <Spinner size="small" /> : 'Add Tag'}
                </button>
            </div>

            <div>
                <h3 className="font-bold mb-2">Current Tags:</h3>
                {filteredTags.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                        {filteredTags.map(tag => (
                            // ✅ FIX: Use tag.id for key and pass tag.id to children
                            <div key={tag.id} className="flex items-center bg-gray-200 text-gray-800 text-sm font-medium px-3 py-1 rounded-full">
                                <Highlight text={tag.id} highlight={newTag} />
                                <span className="ml-2 text-xs bg-gray-300 text-gray-600 px-1.5 py-0.5 rounded-full">{tag.count || 0}</span>
                                <button 
                                    onClick={() => handleDeleteTag(tag.id)}
                                    className="ml-2 text-red-500 hover:text-red-700 font-bold"
                                >
                                    &times;
                                </button>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-gray-500">
                        {tags.length > 0 ? 'No matching tags found.' : 'The tag library is currently empty.'}
                    </p>
                )}
            </div>
        </div>
    );
};

export default TagManager;
