import React, { useState, useEffect } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import Spinner from '../ui/Spinner';

const LegalPage = ({ userProfile, docId, title, setModalMessage, fallbackContent = '', requiredNotice = '' }) => {
    const [content, setContent] = useState('');
    const [editContent, setEditContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const isAdmin = userProfile?.role === 'admin';

    useEffect(() => {
        const docRef = doc(db, 'meta', docId);
        const unsubscribe = onSnapshot(docRef, (docSnap) => {
            if (docSnap.exists()) {
                const fetchedContent = docSnap.data().content || fallbackContent;
                setContent(fetchedContent);
                setEditContent(fetchedContent); 
            } else {
                const initialContent = fallbackContent || 'This page has not been configured yet.';
                setContent(initialContent);
                setEditContent(initialContent);
            }
            setLoading(false);
        }, () => {
            setContent(fallbackContent || 'This page is temporarily unavailable.');
            setEditContent(fallbackContent);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [docId, fallbackContent]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const docRef = doc(db, 'meta', docId);
            await setDoc(docRef, { content: editContent });
            setModalMessage(`${title} has been updated successfully!`);
        } catch (error) {
            setModalMessage(`Error saving content: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    if (loading) {
        return <Spinner />;
    }

    return (
        <div className="max-w-4xl mx-auto mt-10 p-8 bg-white dark:bg-gray-800 rounded-lg shadow-lg">
            <h1 className="text-4xl font-bold text-center text-gray-900 dark:text-white mb-8">{title}</h1>

            {requiredNotice && (
                <div className="mb-8 rounded-lg border border-blue-300 bg-blue-50 p-4 text-gray-900 dark:border-blue-700 dark:bg-blue-950 dark:text-gray-100">
                    {requiredNotice}
                </div>
            )}
            
            {isAdmin ? (
                <div>
                    <textarea
                        value={editContent}
                        onChange={(e) => setEditContent(e.target.value)}
                        className="w-full h-96 p-4 border rounded-md bg-white text-gray-900 dark:bg-gray-900 dark:text-gray-100 font-mono text-sm"
                        placeholder={`Enter the content for the ${title} page here...`}
                    />
                    <div className="flex justify-end mt-4">
                        <button
                            onClick={handleSave}
                            disabled={isSaving}
                            className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-lg disabled:opacity-50"
                        >
                            {isSaving ? 'Saving...' : 'Save Changes'}
                        </button>
                    </div>
                </div>
            ) : (
                <div className="prose max-w-none whitespace-pre-wrap text-gray-800 dark:text-gray-100">
                    {content}
                </div>
            )}
        </div>
    );
};

export default LegalPage;
