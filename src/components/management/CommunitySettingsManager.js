import React, { useState } from 'react';
import { db } from '../../firebase/config';
import { doc, updateDoc } from 'firebase/firestore';
import Spinner from '../ui/Spinner';
import { getGameColor } from '../../utils/helpers';

const CommunitySettingsManager = ({ community, setModalMessage }) => {
    const [themeColor, setThemeColor] = useState(community.themeColor || '#F97316');
    const [allowedGames, setAllowedGames] = useState(community.allowedGames || ['planet-coaster', 'planet-coaster-2', 'planet-zoo']);
    // ✅ 1. Add state for the main game selection
    const [mainGame, setMainGame] = useState(community.mainGame || '');
    const [isSaving, setIsSaving] = useState(false);

    const ALL_GAMES = [
        { id: 'planet-coaster', name: 'Planet Coaster' },
        { id: 'planet-coaster-2', name: 'Planet Coaster 2' },
        { id: 'planet-zoo', name: 'Planet Zoo' },
    ];

    const handleGameToggle = (gameId) => {
        setAllowedGames(prev => {
            if (prev.includes(gameId)) {
                if (prev.length === 1) {
                    setModalMessage("A community must have at least one game enabled.");
                    return prev;
                }
                // If the main game is removed, reset it
                if (mainGame === gameId) {
                    setMainGame('');
                }
                return prev.filter(g => g !== gameId);
            } else {
                return [...prev, gameId];
            }
        });
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            const communityRef = doc(db, 'communitys', community.id);
            await updateDoc(communityRef, {
                themeColor: themeColor,
                allowedGames: allowedGames,
                mainGame: mainGame // ✅ 2. Save the main game selection
            });
            setModalMessage("Settings updated successfully!");
        } catch (error) {
            setModalMessage(`Error saving changes: ${error.message}`);
        } finally {
            setIsSaving(false);
        }
    };

    // Filter the full game list to only show allowed games for the main game dropdown
    const allowedGamesForSelection = ALL_GAMES.filter(game => allowedGames.includes(game.id));

    return (
        <div className="bg-white p-6 rounded-lg shadow-md max-w-lg mx-auto">
            <h3 className="text-2xl font-bold text-gray-800 mb-6 border-b pb-4">General Settings</h3>
            <div className="space-y-6">
                <div>
                    <label className="block text-gray-700 font-bold mb-2">Community Theme Color</label>
                    <p className="text-sm text-gray-500 mb-3">This color will be used for accents and highlights throughout your community's pages and event cards.</p>
                    <div className="flex items-center space-x-4">
                        <input
                            type="color"
                            value={themeColor}
                            onChange={(e) => setThemeColor(e.target.value)}
                            className="h-12 w-24 p-1 border rounded-lg cursor-pointer"
                        />
                        <div className="p-3 rounded-lg font-mono text-lg text-white" style={{ backgroundColor: themeColor }}>
                            {themeColor.toUpperCase()}
                        </div>
                    </div>
                </div>

                <div>
                    <label className="block text-gray-700 font-bold mb-2">Allowed Games</label>
                    <p className="text-sm text-gray-500 mb-3">Select which games can be submitted to this community. At least one must be selected.</p>
                    <div className="flex items-center bg-gray-200 rounded-full p-1 shadow-inner">
                        {ALL_GAMES.map(game => {
                            const isActive = allowedGames.includes(game.id);
                            const color = getGameColor(game.id);
                            return (
                                <button
                                    key={game.id}
                                    type="button"
                                    onClick={() => handleGameToggle(game.id)}
                                    className={`flex-1 py-2 px-2 text-center rounded-full transition-all duration-300 font-semibold text-sm
                                        ${isActive ? `${color.bg} text-white shadow` : 'bg-transparent text-gray-500 hover:bg-gray-300'}
                                    `}
                                >
                                    {game.name}
                                </button>
                            );
                        })}
                    </div>
                </div>

                {/* ✅ 3. New UI for selecting the main game */}
                <div>
                    <label className="block text-gray-700 font-bold mb-2">Main Community Game</label>
                    <p className="text-sm text-gray-500 mb-3">This will be the default game selected when users visit your community page.</p>
                    <select
                        value={mainGame}
                        onChange={(e) => setMainGame(e.target.value)}
                        className="w-full p-2 border rounded-lg bg-white"
                    >
                        <option value="">-- Select a Main Game --</option>
                        {allowedGamesForSelection.map(game => (
                            <option key={game.id} value={game.id}>{game.name}</option>
                        ))}
                    </select>
                </div>


                <div className="flex justify-end pt-6 border-t">
                    <button
                        onClick={handleSave}
                        disabled={isSaving}
                        className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-lg disabled:opacity-50"
                    >
                        {isSaving ? <Spinner size="small" /> : 'Save Settings'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default CommunitySettingsManager;