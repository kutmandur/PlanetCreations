import React, {useId, useRef} from 'react';
import { WEIGHT_KEYS, POOL_DESCRIPTIONS } from '../../utils/feedRanking';
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
    const previousMix = useRef({});
    const change = (key, value) => {
        // Keep the last nonzero mix when a slider briefly consumes all 100%.
        if (WEIGHT_KEYS.some(other => other !== key && !disabledKeys.includes(other) && Number(weights?.[other]) > 0)) {
            previousMix.current[key] = weights;
        }
        onChange(changeFeedPercentage(weights, key, value, disabledKeys, previousMix.current[key]));
    };
    return (
        <div className="space-y-3">
            {WEIGHT_KEYS.map((key) => {
                const disabled = disabledKeys.includes(key);
                return (
                    <div key={key} className={disabled ? 'opacity-50' : ''}>
                        <div className="flex justify-between text-sm mb-1">
                            <label htmlFor={`${id}-${key}`} className="group/pool relative font-semibold text-gray-700 cursor-help" tabIndex={0} aria-describedby={`${id}-${key}-help`}>
                                {labelOverrides[key] || LABELS[key]}
                                <span id={`${id}-${key}-help`} role="tooltip" className="pointer-events-none absolute left-0 bottom-full z-30 mb-2 hidden w-64 max-w-[80vw] rounded-md bg-gray-900 p-3 text-xs font-normal leading-relaxed text-white shadow-lg group-hover/pool:block group-focus/pool:block">
                                    {POOL_DESCRIPTIONS[key]}
                                </span>
                            </label>
                            <span className="text-gray-500">{percentages[key]}%</span>
                        </div>
                        <input
                            id={`${id}-${key}`}
                            type="range"
                            step="1"
                            aria-label={labelOverrides[key] || LABELS[key]}
                            aria-describedby={`${id}-${key}-help`}
                            aria-valuetext={`${percentages[key]}%`}
                            min="0"
                            max="100"
                            value={percentages[key]}
                            disabled={disabled}
                            onChange={(e) => change(key, Number(e.target.value))}
                            className="w-full accent-blue-500"
                        />
                    </div>
                );
            })}
        </div>
    );
};

export default FeedWeightSliders;
