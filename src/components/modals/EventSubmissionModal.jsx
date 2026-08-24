import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../../firebase/config';
import { collection, query, where, getDocs, getCountFromServer } from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';
import Spinner from '../ui/Spinner';
import CreationCard from '../cards/CreationCard';
import Icon from '../ui/Icon';
import { ICONS, containsBlacklistedWord } from '../../utils/helpers';

const SubmissionForm = ({ creation, event, onConfirm, community, blacklist = [] }) => {
    const [customFieldData, setCustomFieldData] = useState({});
    const [checkedRules, setCheckedRules] = useState([]);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');

    const handleFieldChange = (fieldId, value) => {
        setCustomFieldData(prev => ({ ...prev, [fieldId]: value }));
    };

    const handleRuleCheck = (ruleId) => {
        setCheckedRules(prev => 
            prev.includes(ruleId) ? prev.filter(id => id !== ruleId) : [...prev, ruleId]
        );
    };

    const allRulesChecked = (event.rules || []).length === checkedRules.length;
    
    const allRequiredFieldsFilled = (event.customFields || [])
        .filter(field => field.required)
        .every(field => {
            const value = customFieldData[field.id];
            return value != null && String(value).trim() !== '';
        });

    const canSubmit = allRulesChecked && allRequiredFieldsFilled;

    const handleSubmit = async () => {
        // Validate custom field data against blacklist
        for (const value of Object.values(customFieldData)) {
            if (containsBlacklistedWord(String(value), blacklist)) {
                setError('Your submission contains a forbidden word. Please revise it.');
                return;
            }
        }
        setError('');
        setIsSubmitting(true);
        try {
            const submitCreationToEvent = httpsCallable(
                getFunctions(), 'submitCreationToEvent');
            const response = await submitCreationToEvent({
                acceptedRuleIds: checkedRules,
                creationId: creation.id,
                customFieldData,
                eventId: event.id,
            });
            onConfirm(creation.id, response.data?.title);
        } catch (error) {
            console.error("Error submitting creation:", error);
            setError(error.message || 'The creation could not be submitted.');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="p-4 bg-gray-100 rounded-b-lg border-t">
            {event.customFields?.length > 0 && (
                <div className="mb-4">
                    <h4 className="font-bold mb-2">Event Fields</h4>
                    <div className="space-y-3">
                        {event.customFields.map(field => (
                            <div key={field.id}>
                                <label className="block text-sm font-semibold text-gray-700">
                                    {field.label} {field.required && <span className="text-red-500">*</span>}
                                </label>
                                <input
                                    type="text"
                                    onChange={(e) => handleFieldChange(field.id, e.target.value)}
                                    className="w-full p-2 border rounded-md mt-1"
                                    required={field.required}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            )}
            {event.rules?.length > 0 && (
                <div className="mb-4">
                    <h4 className="font-bold mb-2">Confirm Rules</h4>
                    <div className="space-y-2">
                        {event.rules.map(rule => (
                            <label key={rule.id} className="flex items-center">
                                <input
                                    type="checkbox"
                                    onChange={() => handleRuleCheck(rule.id)}
                                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                                />
                                <span className="ml-2 text-sm text-gray-800">{rule.text}</span>
                            </label>
                        ))}
                    </div>
                </div>
            )}
            {error && <p className="text-red-500 text-sm mb-2">{error}</p>}
            <button
                onClick={handleSubmit}
                disabled={!canSubmit || isSubmitting}
                className="w-full font-bold py-2 px-4 rounded-lg text-white disabled:opacity-50 transition-colors"
                style={{ backgroundColor: community?.themeColor || '#10B981' }}
            >
                {isSubmitting ? 'Submitting...' : 'Confirm Submission'}
            </button>
        </div>
    );
};


const EventSubmissionModal = ({ user, event, community, onClose, setModalMessage, blacklist = [] }) => {
    const [userCreations, setUserCreations] = useState([]);
    const [loading, setLoading] = useState(true);
    const [searchTerm, setSearchTerm] = useState('');
    const [selectedCreationId, setSelectedCreationId] = useState(null);

    useEffect(() => {
        const fetchCreations = async () => {
            const creationsQuery = query(collection(db, 'creations'), where('userId', '==', user.uid));
            const submissionCountQuery = query(
                collection(db, 'creations'),
                where('userId', '==', user.uid),
                where('eventIds', 'array-contains', event.id)
            );

            const [snapshot, submissionCountSnapshot] = await Promise.all([
                getDocs(creationsQuery),
                getCountFromServer(submissionCountQuery)
            ]);
            
            const userSubmissionCount = submissionCountSnapshot.data().count;
            const submissionLimit = event.submissionLimit || 1;
            
            const limitReached = (!event.allowMultipleSubmissions && userSubmissionCount > 0) ||
                                 (event.allowMultipleSubmissions && userSubmissionCount >= submissionLimit);

            if (limitReached) {
                setModalMessage("You have already reached the submission limit for this event.");
                onClose();
                return;
            }

            let creations = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

            creations = creations.filter(c => {
                if (c.game !== event.game) return false;
                if (c.eventIds && c.eventIds.includes(event.id)) return false;
                if (event.blockOldCreations && event.creationCutoffDate) {
                    if (c.createdAt.toDate() < event.creationCutoffDate.toDate()) {
                        return false;
                    }
                }
                return true;
            });
            setUserCreations(creations);
            setLoading(false);
        };
        fetchCreations();
    }, [user.uid, event, setModalMessage, onClose]);

    const handleConfirmSubmission = (submittedCreationId, submittedTitle) => {
        const title = submittedTitle ||
            userCreations.find(c => c.id === submittedCreationId)?.title ||
            'Creation';
        setModalMessage(`"${title}" was successfully submitted!`);
        onClose(submittedCreationId);
    };

    const filteredCreations = useMemo(() => {
        return userCreations.filter(c => 
            c.title.toLowerCase().includes(searchTerm.toLowerCase())
        );
    }, [userCreations, searchTerm]);

    return (
        <div className="fixed inset-0 bg-black/60 flex justify-center items-center z-50 p-4" onClick={() => onClose(null)}>
            <div className="bg-gray-100 rounded-xl shadow-2xl w-full max-w-4xl h-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b bg-white rounded-t-xl flex justify-between items-center">
                    <div>
                        <h3 className="text-xl font-bold">Submit a Creation to "{event.title}"</h3>
                        <p className="text-sm text-gray-500">Select one of your eligible creations below.</p>
                    </div>
                    <button onClick={() => onClose(null)} className="text-gray-500 hover:text-gray-800"><Icon path={ICONS.xMark} className="w-8 h-8" /></button>
                </div>
                <div className="p-4">
                    <input
                        type="text"
                        placeholder="Search your creations..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="w-full p-3 bg-white border rounded-full focus:outline-none focus:ring-2"
                        style={{'--tw-ring-color': community?.themeColor}}
                    />
                </div>
                <div className="flex-grow overflow-y-auto p-4">
                    {loading ? <Spinner /> : (
                        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                            {filteredCreations.map(creation => (
                                <div key={creation.id}>
                                    <div onClick={() => setSelectedCreationId(prevId => prevId === creation.id ? null : creation.id)}>
                                        <CreationCard creation={creation} isLink={false} />
                                    </div>
                                    {selectedCreationId === creation.id && (
                                        <SubmissionForm
                                            creation={creation}
                                            event={event}
                                            community={community}
                                            onConfirm={handleConfirmSubmission}
                                            blacklist={blacklist}
                                        />
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                    {!loading && filteredCreations.length === 0 && (
                        <p className="text-center text-gray-500 mt-10">You have no eligible creations to submit to this event.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default EventSubmissionModal;
