import React, {useId} from 'react';
import { WEIGHT_KEYS } from '../../utils/feedRanking';
import {feedPercentages, changeFeedPercentage} from '../../utils/feedMix';

const LABELS = {
    live: 'Live creations',
    recency: 'New creations',
    popularity: 'Popular creations',
    activity: 'Actively updated',
    affinity: 'Matches my interests',
    discovery: 'Discovery / variety',
};

const FeedWeightSliders = ({ weights, onChange, disabledKeys = [], labelOverrides = {} }) => {
    const id = useId();
    const percentages = feedPercentages(weights, disabledKeys);
    return (
        <div className="space-y-3">
            {WEIGHT_KEYS.map((key) => {
                const disabled = disabledKeys.includes(key);
                return (
                    <div key={key} className={disabled ? 'opacity-50' : ''}>
                        <div className="flex justify-between text-sm mb-1">
                            <label htmlFor={`${id}-${key}`} className="font-semibold text-gray-700">{labelOverrides[key] || LABELS[key]}</label>
                            <span className="text-gray-500">{percentages[key]}%</span>
                        </div>
                        <input
                            id={`${id}-${key}`}
                            type="range"
                            step="1"
                            aria-valuetext={`${percentages[key]}%`}
                            min="0"
                            max="100"
                            value={percentages[key]}
                            disabled={disabled}
                            onChange={(e) => onChange(changeFeedPercentage(weights, key, Number(e.target.value), disabledKeys))}
                            className="w-full accent-blue-500"
                        />
                    </div>
                );
            })}
        </div>
    );
};

export default FeedWeightSliders;
