import React from 'react';
import { WEIGHT_KEYS, normalizeWeights, DEFAULT_WEIGHTS } from '../../utils/feedRanking';

const LABELS = {
    recency: 'New creations',
    popularity: 'Popular creations',
    activity: 'Actively updated',
    affinity: 'Matches my interests',
    discovery: 'Discovery / variety',
};

// Gemeinsame Slider-Gruppe für die Feed-Gewichte (Settings + Admin-Panel).
// Werte sind relative Anteile 0–100; daneben wird der normierte Anteil in %
// angezeigt (so sieht man direkt, "wie viel von was" der Feed enthält).
const FeedWeightSliders = ({ weights, onChange, disabledKeys = [], labelOverrides = {} }) => {
    const normalized = normalizeWeights(weights);
    return (
        <div className="space-y-3">
            {WEIGHT_KEYS.map((key) => {
                const disabled = disabledKeys.includes(key);
                return (
                    <div key={key} className={disabled ? 'opacity-50' : ''}>
                        <div className="flex justify-between text-sm mb-1">
                            <span className="font-semibold text-gray-700">{labelOverrides[key] || LABELS[key]}</span>
                            <span className="text-gray-500">{Math.round(normalized[key] * 100)}%</span>
                        </div>
                        <input
                            type="range"
                            min="0"
                            max="100"
                            value={Number.isFinite(Number(weights[key])) ? Number(weights[key]) : DEFAULT_WEIGHTS[key]}
                            disabled={disabled}
                            onChange={(e) => onChange({ ...weights, [key]: Number(e.target.value) })}
                            className="w-full accent-blue-500"
                        />
                    </div>
                );
            })}
        </div>
    );
};

export default FeedWeightSliders;
