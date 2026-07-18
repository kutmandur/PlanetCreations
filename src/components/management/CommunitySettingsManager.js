import React, { useState } from 'react';
import { db, auth } from '../../firebase/config';
import { doc, updateDoc } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import { getGameColor, SOCIAL_PLATFORMS } from '../../utils/helpers';
import { getEnabledGameIds } from '../../utils/gamesRegistry';
import useGames from '../../hooks/useGames';
import { transferCommunityOwnership } from '../../firebase/community';

const CommunitySettingsManager = ({ community, members = [], setModalMessage, setPasswordConfirm, onTransferComplete }) => {
    const [themeColor, setThemeColor] = useState(community.themeColor || '#F97316');
    const [allowedGames, setAllowedGames] = useState(community.allowedGames || getEnabledGameIds());
    // ✅ 1. Add state for the main game selection
    const [mainGame, setMainGame] = useState(community.mainGame || '');
    const [socialLinks, setSocialLinks] = useState(community.socialLinks || {});
    const [isSaving, setIsSaving] = useState(false);
    const [transferTarget, setTransferTarget] = useState('');

    // Ownership-Transfer: nur der aktuelle Owner sieht die Danger Zone.
    const meUid = auth.currentUser?.uid;
    const isCurrentUserOwner = !!(meUid && community.ownerId === meUid);
    const transferCandidates = members.filter(m => m.id !== meUid);

    const handleTransferOwnership = () => {
        if (!isCurrentUserOwner || !setPasswordConfirm || !transferTarget) return;
        const target = members.find(m => m.id === transferTarget);
        const targetName = target?.username || 'this member';
        setPasswordConfirm({
            message: `Transfer ownership of "${community.name}" to "${targetName}"? You will become a regular member. Confirm with your password.`,
            onConfirm: async (password) => {
                try {
                    const u = auth.currentUser;
                    const credential = EmailAuthProvider.credential(u.email, password);
                    await reauthenticateWithCredential(u, credential);
                    await transferCommunityOwnership(community.id, transferTarget, meUid, community.defaultRankName);
                    setModalMessage(`Ownership transferred to ${targetName}.`);
                    if (onTransferComplete) onTransferComplete();
                } catch (error) {
                    setModalMessage(`Error transferring ownership: ${error.message}`);
                }
            }
        });
    };

    const handleSocialLinkChange = (platformId, value) => {
        setSocialLinks(prev => ({ ...prev, [platformId]: value }));
    };

    const ALL_GAMES = useGames();

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
        // Nur ausgefüllte, plausible Links speichern
        const cleanedLinks = {};
        for (const platform of SOCIAL_PLATFORMS) {
            const value = (socialLinks[platform.id] || '').trim();
            if (!value) continue;
            if (!/^https:\/\//i.test(value)) {
                setModalMessage(`The ${platform.label} link must start with https://`);
                return;
            }
            cleanedLinks[platform.id] = value;
        }

        setIsSaving(true);
        try {
            const communityRef = doc(db, 'communitys', community.id);
            await updateDoc(communityRef, {
                themeColor: themeColor,
                allowedGames: allowedGames,
                mainGame: mainGame, // ✅ 2. Save the main game selection
                socialLinks: cleanedLinks
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
                    <div className="flex items-center bg-gray-200 rounded-full p-1 shadow-inner overflow-x-auto">
                        {ALL_GAMES.map(game => {
                            const isActive = allowedGames.includes(game.id);
                            const color = getGameColor(game.id);
                            return (
                                <button
                                    key={game.id}
                                    type="button"
                                    onClick={() => handleGameToggle(game.id)}
                                    style={color.style}
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


                <div>
                    <label className="block text-gray-700 font-bold mb-2">Social Links</label>
                    <p className="text-sm text-gray-500 mb-3">
                        These appear as clickable icons on your community banner. A linked YouTube channel also
                        enables the YouTube tab on your community's Videos page.
                    </p>
                    <div className="space-y-3">
                        {SOCIAL_PLATFORMS.map(platform => (
                            <div key={platform.id} className="flex items-center gap-3">
                                <div className="w-9 h-9 flex-shrink-0 rounded-full bg-gray-100 flex items-center justify-center text-gray-600" title={platform.label}>
                                    <Icon path={platform.icon} solid={platform.solid} className="w-5 h-5" />
                                </div>
                                <input
                                    type="url"
                                    value={socialLinks[platform.id] || ''}
                                    onChange={(e) => handleSocialLinkChange(platform.id, e.target.value)}
                                    placeholder={platform.placeholder}
                                    className="flex-grow p-2 border rounded-lg"
                                />
                            </div>
                        ))}
                    </div>
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

                {isCurrentUserOwner && (
                    <div className="pt-6 border-t border-red-200">
                        <h4 className="text-lg font-bold text-red-600 mb-2">Danger Zone</h4>
                        <label className="block text-gray-700 font-bold mb-2">Transfer Ownership</label>
                        <p className="text-sm text-gray-500 mb-3">
                            Hand this community over to another member. The new owner gets full control;
                            you will be demoted to a regular member. This cannot be undone by you.
                        </p>
                        <div className="flex items-center gap-3">
                            <select
                                value={transferTarget}
                                onChange={(e) => setTransferTarget(e.target.value)}
                                className="flex-grow p-2 border rounded-lg bg-white"
                            >
                                <option value="">-- Select new owner --</option>
                                {transferCandidates.map(m => (
                                    <option key={m.id} value={m.id}>{m.username || m.id}</option>
                                ))}
                            </select>
                            <button
                                onClick={handleTransferOwnership}
                                disabled={!transferTarget}
                                className="bg-red-600 hover:bg-red-700 text-white font-bold py-2 px-4 rounded-lg disabled:opacity-50 whitespace-nowrap"
                            >
                                Transfer
                            </button>
                        </div>
                        {transferCandidates.length === 0 && (
                            <p className="text-sm text-gray-400 mt-2">No other members to transfer to yet.</p>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default CommunitySettingsManager;