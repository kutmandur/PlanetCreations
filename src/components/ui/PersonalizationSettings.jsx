import React, { useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useQuery } from '@tanstack/react-query';
import FeedWeightSliders from './FeedWeightSliders';
import { DEFAULT_WEIGHTS } from '../../utils/feedRanking';
import {
    getPersonalizationConsent,
    setPersonalizationEnabled,
    resetInterests,
    getLocalFeedWeights,
    saveFeedWeights,
} from '../../utils/interestTracker';

// Settings-Abschnitt "Personalized Recommendations":
//  - Opt-in/Opt-out-Toggle (aus = keinerlei Datenerhebung)
//  - "Reset feed preferences" (löscht die Tag-Map, unabhängig vom Toggle)
//  - Feed-Slider: persönliche Gewichtung der Feed-Anteile (überschreibt das
//    globale Admin-Default; unabhängig vom Opt-in — nur der Interessen-Anteil
//    läuft ohne Opt-in leer und ist deshalb ausgegraut)
const PersonalizationSettings = ({ user, setModalMessage, setConfirmation, embedded = false }) => {
    const [enabled, setEnabled] = useState(getPersonalizationConsent() === true);
    const [saving, setSaving] = useState(false);

    // Globales Default als Slider-Startwert, falls der User nie etwas gesetzt hat
    const { data: globalWeights } = useQuery({
        queryKey: ['feedWeights'],
        queryFn: async () => {
            const snap = await getDoc(doc(db, 'meta', 'feedWeights'));
            return snap.exists() ? snap.data() : null;
        },
        staleTime: 30 * 60 * 1000,
    });

    const [weights, setWeights] = useState(() => getLocalFeedWeights());
    const [weightsDirty, setWeightsDirty] = useState(false);
    const effectiveWeights = weights || globalWeights || DEFAULT_WEIGHTS;

    const handleToggle = async () => {
        const next = !enabled;
        setEnabled(next);
        try {
            await setPersonalizationEnabled(user.uid, next);
        } catch (e) {
            setEnabled(!next);
            setModalMessage(`Could not save the setting: ${e.message}`);
        }
    };

    const handleReset = () => {
        setConfirmation({
            message: 'Reset your feed preferences? Your collected tag interests will be deleted (this does not change the personalization on/off setting).',
            onConfirm: async () => {
                try {
                    await resetInterests(user.uid);
                    setModalMessage('Your feed preferences have been reset.');
                } catch (e) {
                    setModalMessage(`Reset failed: ${e.message}`);
                }
            },
        });
    };

    const handleWeightsChange = (next) => {
        setWeights(next);
        setWeightsDirty(true);
    };

    const handleWeightsSave = async () => {
        setSaving(true);
        try {
            await saveFeedWeights(user.uid, weights);
            setWeightsDirty(false);
            setModalMessage('Feed mix saved.');
        } catch (e) {
            setModalMessage(`Could not save: ${e.message}`);
        } finally {
            setSaving(false);
        }
    };

    const handleWeightsReset = async () => {
        setSaving(true);
        try {
            await saveFeedWeights(user.uid, null);
            setWeights(null);
            setWeightsDirty(false);
            setModalMessage('Feed mix reset to the site default.');
        } catch (e) {
            setModalMessage(`Could not reset: ${e.message}`);
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className={embedded ? '' : 'bg-white p-6 rounded-lg shadow-md'}>
            {!embedded && <h2 className="text-2xl font-bold mb-2">Personalized Recommendations</h2>}
            <p className={`text-gray-600 dark:text-gray-300 mb-4 ${embedded ? 'text-center' : ''}`}>
                When enabled, your tag clicks, searches and viewed creations personalize
                the "Recommended" home feed. Only an aggregated tag list is stored — no
                history. Nothing is collected while this is off.
            </p>

            <label className="flex items-center justify-between gap-4 bg-gray-100 p-3 rounded-lg cursor-pointer">
                <span className="text-gray-700 font-semibold">Use my activity to personalize the home feed</span>
                <div
                    onClick={(e) => { e.preventDefault(); handleToggle(); }}
                    className="relative w-14 h-8 flex items-center rounded-full cursor-pointer p-1 transition-colors duration-300 flex-shrink-0"
                    style={{ backgroundColor: enabled ? '#34D399' : '#D1D5DB' }}
                >
                    <div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${enabled ? 'translate-x-6' : 'translate-x-0'}`}></div>
                </div>
            </label>

            <button
                onClick={handleReset}
                className="w-full mt-3 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg"
            >
                Reset feed preferences
            </button>

            <div className="mt-6 pt-6 border-t">
                <h3 className={`text-lg font-bold mb-1 ${embedded ? 'text-center' : ''}`}>Feed mix</h3>
                <p className={`text-sm text-gray-500 mb-4 ${embedded ? 'text-center' : ''}`}>
                    How much of what do you want to see in your Recommended feed?
                    {!enabled && ' ("Matches my interests" needs personalization enabled.)'}
                </p>
                <FeedWeightSliders
                    weights={effectiveWeights}
                    onChange={handleWeightsChange}
                    disabledKeys={enabled ? [] : ['affinity']}
                />
                <div className="flex gap-3 mt-4">
                    <button
                        onClick={handleWeightsSave}
                        disabled={saving || !weightsDirty}
                        className="flex-1 bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50"
                    >
                        {saving ? 'Saving...' : 'Save feed mix'}
                    </button>
                    <button
                        onClick={handleWeightsReset}
                        disabled={saving}
                        className="flex-1 bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-2 px-4 rounded-lg disabled:opacity-50"
                    >
                        Use site default
                    </button>
                </div>
            </div>
        </div>
    );
};

export default PersonalizationSettings;
