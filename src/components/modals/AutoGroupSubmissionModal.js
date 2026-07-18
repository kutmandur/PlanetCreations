import React, { useState, useEffect } from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const AutoGroupSubmissionsModal = ({ onClose, onConfirm, communityRanks, color }) => {
    const [creationsPerGroup, setCreationsPerGroup] = useState(2);
    const [groupBy, setGroupBy] = useState('random');
    const [forbiddenRankCombinations, setForbiddenRankCombinations] = useState([]);
    const [currentPairSelection, setCurrentPairSelection] = useState([]);
    const [ranksToConsiderForGrouping, setRanksToConsiderForGrouping] = useState([]);
    const [ignoreForbiddenRule, setIgnoreForbiddenRule] = useState(false);

    useEffect(() => {
        // By default, all ranks are considered for grouping.
        if (communityRanks) {
            setRanksToConsiderForGrouping(communityRanks.map(r => r.name));
        }
    }, [communityRanks]);

    const handleForbiddenRankClick = (rankName) => {
        if (currentPairSelection.includes(rankName)) {
            setCurrentPairSelection(prev => prev.filter(r => r !== rankName));
            return;
        }

        if (currentPairSelection.length === 0) {
            setCurrentPairSelection([rankName]);
        } else if (currentPairSelection.length === 1) {
            const newPair = [currentPairSelection[0], rankName].sort();
            // Avoid adding duplicate pairs
            if (!forbiddenRankCombinations.some(p => p[0] === newPair[0] && p[1] === newPair[1])) {
                setForbiddenRankCombinations(prev => [...prev, newPair]);
            }
            setCurrentPairSelection([]);
        }
    };

    const handleDeleteForbiddenPair = (index) => {
        setForbiddenRankCombinations(prev => prev.filter((_, i) => i !== index));
    };
    
    const handleConsiderRankToggle = (rankName) => {
        setRanksToConsiderForGrouping(prev =>
            prev.includes(rankName)
                ? prev.filter(r => r !== rankName)
                : [...prev, rankName]
        );
    };

    const handleConfirm = () => {
        onConfirm({
            creationsPerGroup: Number(creationsPerGroup),
            groupBy,
            forbiddenRankCombinations,
            ignoreForbiddenRule,
            ranksToConsiderForGrouping,
        });
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex justify-center items-center z-50 p-4" onClick={onClose} style={color?.style}>
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
                <div className="flex justify-between items-center mb-4 pb-2 border-b">
                    <h2 className="text-2xl font-bold">Automatic Grouping</h2>
                    <button onClick={onClose} className="text-gray-500 hover:text-gray-800">
                        <Icon path={ICONS.xMark} className="w-6 h-6" />
                    </button>
                </div>

                <div className="space-y-4">
                    <div>
                        <label className="block text-gray-700 font-bold mb-2">Creations per Group</label>
                        <input
                            type="number"
                            value={creationsPerGroup}
                            onChange={(e) => setCreationsPerGroup(e.target.value)}
                            min="2"
                            className="w-full p-2 border rounded-lg"
                        />
                    </div>

                    <div>
                        <label className="block text-gray-700 font-bold mb-2">Group by</label>
                        <select
                            value={groupBy}
                            onChange={(e) => setGroupBy(e.target.value)}
                            className="w-full p-2 border rounded-lg bg-white"
                        >
                            <option value="random">Random</option>
                            <option value="votes">Votes</option>
                            <option value="reactions">Discord Reactions</option>
                            <option value="ranks">Creator Ranks</option>
                        </select>
                    </div>
                    
                    {groupBy === 'ranks' && (
                        <div>
                            <label className="block text-gray-700 font-bold mb-2">Ranks to Consider for Grouping</label>
                             <div className="p-3 border rounded-lg flex flex-wrap gap-2 bg-gray-50">
                                {communityRanks.map(rank => (
                                    <button
                                        key={rank.name}
                                        type="button"
                                        onClick={() => handleConsiderRankToggle(rank.name)}
                                        className={`px-3 py-1 text-sm rounded-full font-semibold transition-colors ${ranksToConsiderForGrouping.includes(rank.name) ? 'bg-green-500 text-white' : 'bg-gray-200 text-gray-700'}`}
                                    >
                                        {rank.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="block text-gray-700 font-bold mb-2">Forbidden Rank Combinations</label>
                        <p className="text-xs text-gray-500 mb-2">Select two ranks to create a pair that cannot be in the same group.</p>
                        <div className="p-3 border rounded-lg flex flex-wrap gap-2 bg-gray-50">
                            {communityRanks.map(rank => (
                                <button
                                    key={rank.name}
                                    type="button"
                                    onClick={() => handleForbiddenRankClick(rank.name)}
                                    className={`px-3 py-1 text-sm rounded-full font-semibold transition-colors ${currentPairSelection.includes(rank.name) ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'}`}
                                >
                                    {rank.name}
                                </button>
                            ))}
                        </div>
                        {forbiddenRankCombinations.length > 0 && (
                            <div className="mt-2 space-y-2">
                                {forbiddenRankCombinations.map((pair, index) => (
                                    <div key={index} className="flex items-center justify-between bg-red-100 p-2 rounded">
                                        <span className="text-red-800 text-sm font-medium">{pair[0]} &harr; {pair[1]}</span>
                                        <button onClick={() => handleDeleteForbiddenPair(index)} className="text-red-600 hover:text-red-900 font-bold">&times;</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center space-x-4 bg-gray-100 p-3 rounded-lg">
                        <span className="text-gray-600">Ignore forbidden rule if group cannot be filled?</span>
                        <div className="relative w-14 h-8 flex items-center rounded-full cursor-pointer p-1 transition-colors duration-300"
                             onClick={() => setIgnoreForbiddenRule(!ignoreForbiddenRule)}
                             style={{ backgroundColor: ignoreForbiddenRule ? '#34D399' : '#D1D5DB' }}
                        >
                            <div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${ignoreForbiddenRule ? 'translate-x-6' : 'translate-x-0'}`}></div>
                        </div>
                    </div>
                </div>

                <div className="mt-6 pt-4 border-t flex justify-end">
                    <button onClick={handleConfirm} className={`${color.bg} ${color.hoverBg} text-white font-bold py-2 px-6 rounded-lg`}>
                        Generate Groups
                    </button>
                </div>
            </div>
        </div>
    );
};

export default AutoGroupSubmissionsModal;