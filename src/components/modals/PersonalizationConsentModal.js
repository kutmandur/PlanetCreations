import React from 'react';

// Einmaliges Opt-in-Popover beim ersten Login: Personalisierung ist bis zur
// Zustimmung komplett aus (keinerlei Datenerhebung). Beide Antworten werden
// gespeichert, damit nie erneut gefragt wird.
const PersonalizationConsentModal = ({ onAnswer }) => (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50 p-4">
        <div className="bg-white p-8 rounded-lg shadow-xl max-w-md text-center">
            <h2 className="text-xl font-bold mb-3">Personalized recommendations</h2>
            <p className="text-gray-600 mb-2">
                Allow PlanetCreations to use your tag clicks, searches and viewed
                creations to personalize your home feed?
            </p>
            <p className="text-sm text-gray-500 mb-6">
                Only an aggregated tag list is stored — no history. You can change
                this and reset the data anytime in Settings.
            </p>
            <div className="flex justify-center space-x-4">
                <button
                    onClick={() => onAnswer(false)}
                    className="bg-gray-300 hover:bg-gray-400 text-black font-bold py-2 px-6 rounded-lg w-1/2"
                >
                    No thanks
                </button>
                <button
                    onClick={() => onAnswer(true)}
                    className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-lg w-1/2"
                >
                    Enable
                </button>
            </div>
        </div>
    </div>
);

export default PersonalizationConsentModal;
