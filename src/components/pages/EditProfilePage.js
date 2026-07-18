import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { doc, getDoc, setDoc, collection, getDocs } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { getGameColor, containsBlacklistedWord, ICONS } from '../../utils/helpers';
import { getDefaultGameId, getGame } from '../../utils/gamesRegistry';
import useGames from '../../hooks/useGames';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import InfoBox from '../ui/InfoBox';

const EditProfilePage = ({ user, setModalMessage, blacklist }) => {
    const [loading, setLoading] = useState(true);
    const [profileData, setProfileData] = useState(null);
    const navigate = useNavigate();

    const [allDlcs, setAllDlcs] = useState({});
    const [selectedGameForDlc, setSelectedGameForDlc] = useState(getDefaultGameId());

    const tabRefs = useRef([]);
    const gliderRef = useRef(null);

    const TABS = useGames();

    const color = getGameColor(profileData?.favoriteGame);

    useEffect(() => {
        const fetchData = async () => {
            if (!user) {
                navigate('/login');
                return;
            }
            
            const profileRef = doc(db, 'profiles', user.uid);
            const profileSnap = await getDoc(profileRef);
            if (profileSnap.exists()) {
                const data = profileSnap.data();
                setProfileData(data);
                setSelectedGameForDlc(getGame(data.favoriteGame) ? data.favoriteGame : getDefaultGameId());
            } else {
                setProfileData({ username: 'New User', favoriteGame: getDefaultGameId(), ownedDlcs: {}, platformPreferences: {} });
            }

            const dlcCollectionRef = collection(db, 'dlcs');
            const dlcSnapshot = await getDocs(dlcCollectionRef);
            const dlcData = {};
            dlcSnapshot.forEach(doc => {
                dlcData[doc.id] = doc.data().names || [];
            });
            setAllDlcs(dlcData);
            
            setLoading(false);
        };
        fetchData();
    }, [user, navigate]);

    useEffect(() => {
        if (!loading) {
            const activeTabIndex = TABS.findIndex(tab => tab.id === selectedGameForDlc);
            const activeTabNode = tabRefs.current[activeTabIndex];
            if (activeTabNode && gliderRef.current) {
                gliderRef.current.style.left = `${activeTabNode.offsetLeft}px`;
                gliderRef.current.style.width = `${activeTabNode.offsetWidth}px`;
            }
        }
    }, [selectedGameForDlc, TABS, loading]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        setProfileData(prev => ({ ...prev, [name]: value }));
    };

    const handleFavoriteGame = () => {
        setProfileData(prev => ({ ...prev, favoriteGame: selectedGameForDlc }));
    };

    const handleDlcChange = (dlcName) => {
        setProfileData(prev => {
            const currentDlcs = prev.ownedDlcs?.[selectedGameForDlc] || [];
            const newDlcs = currentDlcs.includes(dlcName)
                ? currentDlcs.filter(d => d !== dlcName)
                : [...currentDlcs, dlcName];
            
            return {
                ...prev,
                ownedDlcs: { ...prev.ownedDlcs, [selectedGameForDlc]: newDlcs }
            };
        });
    };
    
    // ✅ NEW: Handler for the platform preference toggle
    const handlePlatformPreferenceChange = () => {
        setProfileData(prev => {
            const currentPref = prev.platformPreferences?.[selectedGameForDlc] || 'pc';
            const newPref = currentPref === 'pc' ? 'console' : 'pc';
            return {
                ...prev,
                platformPreferences: { ...prev.platformPreferences, [selectedGameForDlc]: newPref }
            };
        });
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (containsBlacklistedWord(profileData.bio, blacklist)) {
            setModalMessage("Your bio contains a forbidden word.");
            return;
        }
        setLoading(true);
        try {
            const docRef = doc(db, 'profiles', user.uid);
            await setDoc(docRef, profileData, { merge: true });
            setModalMessage("Profile updated successfully!");
            navigate(`/profile/${user.uid}`);
        } catch (error) {
            setModalMessage(`Error: ${error.message}`);
        } finally {
            setLoading(false);
        }
    };

    if (loading || !profileData) return <Spinner />;

    const ownedDlcsForSelectedGame = profileData.ownedDlcs?.[selectedGameForDlc] || [];
    const dlcSelectorColor = getGameColor(selectedGameForDlc);
    const platformPreference = profileData.platformPreferences?.[selectedGameForDlc] || 'pc';

    return (
        <div className="max-w-2xl mx-auto mt-10 p-8 bg-white rounded-lg shadow-lg" style={color.style}>
            <h1 className="text-3xl font-bold text-center mb-6">Edit Your Profile</h1>
            <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                    <label className="block text-gray-700 font-bold mb-2" htmlFor="profilePictureUrl">Profile Picture URL</label>
                    <input type="url" name="profilePictureUrl" id="profilePictureUrl" value={profileData.profilePictureUrl || ''} onChange={handleChange} className={`w-full p-3 border rounded-lg focus:ring-2 ${color.ring}`} placeholder="https://..." />
                    <div className="mt-2"><InfoBox /></div>
                </div>
                 <div>
                    <label className="block text-gray-700 font-bold mb-2" htmlFor="bio">Bio</label>
                    <textarea name="bio" id="bio" value={profileData.bio || ''} onChange={handleChange} rows="4" className={`w-full p-3 border rounded-lg focus:ring-2 ${color.ring}`} placeholder="Tell us about yourself..."></textarea>
                </div>
                 <div>
                    <label className="block text-gray-700 font-bold mb-2" htmlFor="country">Country</label>
                    <input type="text" name="country" id="country" value={profileData.country || ''} onChange={handleChange} className={`w-full p-3 border rounded-lg focus:ring-2 ${color.ring}`} placeholder="e.g. Germany" />
                </div>
                
                <div>
                    <h3 className="text-lg font-bold text-gray-800 border-b pb-2 mb-4">Social Media Links</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div><label className="block text-gray-700 font-bold mb-1" htmlFor="youtube">YouTube</label><input type="url" name="youtube" id="youtube" value={profileData.youtube || ''} onChange={handleChange} className="w-full p-2 border rounded-lg" placeholder="https://youtube.com/..." /></div>
                        <div><label className="block text-gray-700 font-bold mb-1" htmlFor="twitch">Twitch</label><input type="url" name="twitch" id="twitch" value={profileData.twitch || ''} onChange={handleChange} className="w-full p-2 border rounded-lg" placeholder="https://twitch.tv/..." /></div>
                        <div><label className="block text-gray-700 font-bold mb-1" htmlFor="instagram">Instagram</label><input type="url" name="instagram" id="instagram" value={profileData.instagram || ''} onChange={handleChange} className="w-full p-2 border rounded-lg" placeholder="https://instagram.com/..." /></div>
                        <div><label className="block text-gray-700 font-bold mb-1" htmlFor="tiktok">TikTok</label><input type="url" name="tiktok" id="tiktok" value={profileData.tiktok || ''} onChange={handleChange} className="w-full p-2 border rounded-lg" placeholder="https://tiktok.com/@..." /></div>
                        <div><label className="block text-gray-700 font-bold mb-1" htmlFor="x">X (Twitter)</label><input type="url" name="x" id="x" value={profileData.x || ''} onChange={handleChange} className="w-full p-2 border rounded-lg" placeholder="https://x.com/..." /></div>
                        <div><label className="block text-gray-700 font-bold mb-1" htmlFor="discord">Discord</label><input type="text" name="discord" id="discord" value={profileData.discord || ''} onChange={handleChange} className="w-full p-2 border rounded-lg" placeholder="User-ID" /></div>
                        <div><label className="block text-gray-700 font-bold mb-1" htmlFor="steam">Steam</label><input type="url" name="steam" id="steam" value={profileData.steam || ''} onChange={handleChange} className="w-full p-2 border rounded-lg" placeholder="https://steamcommunity.com/id/..." /></div>
                        <div><label className="block text-gray-700 font-bold mb-1" htmlFor="website">Website</label><input type="url" name="website" id="website" value={profileData.website || ''} onChange={handleChange} className="w-full p-2 border rounded-lg" placeholder="https://..." /></div>
                    </div>
                </div>

                <div style={dlcSelectorColor.style}>
                    <h3 className="text-lg font-bold text-gray-800 border-b pb-2 mb-4">My Game Preferences</h3>
                    <p className="text-sm text-gray-500 mb-4">Select a game to manage your preferences and owned DLCs.</p>
                    <div className="flex justify-center">
                        <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner overflow-x-auto">
                            <div ref={gliderRef} className={`absolute h-full rounded-full ${dlcSelectorColor.bg} transition-all duration-500 ease-in-out`} />
                            {TABS.map((tab, index) => (
                                <button
                                    key={tab.id}
                                    type="button"
                                    ref={el => tabRefs.current[index] = el}
                                    onClick={() => setSelectedGameForDlc(tab.id)}
                                    className={`relative z-10 py-2 px-4 sm:px-6 rounded-full transition-colors duration-300 text-sm sm:text-base font-medium whitespace-nowrap ${ selectedGameForDlc === tab.id ? 'text-white' : 'text-gray-600 hover:text-black'}`}
                                >
                                    {tab.name}
                                </button>
                            ))}
                        </div>
                    </div>

                    <div className="mt-4 flex justify-center items-center gap-4">
                         <button 
                            type="button" 
                            onClick={handleFavoriteGame}
                            className={`flex items-center space-x-2 px-4 py-2 rounded-full transition-colors text-sm font-semibold
                                ${profileData.favoriteGame === selectedGameForDlc 
                                    ? 'bg-red-100 text-red-600' 
                                    : 'bg-gray-100 text-gray-600 hover:bg-red-50'
                                }`}
                        >
                            <Icon path={ICONS.heart} className="w-5 h-5" solid={profileData.favoriteGame === selectedGameForDlc} />
                            <span>Favorite Game</span>
                        </button>
                    </div>
                    
                    {/* ✅ ADDED: Platform preference toggle */}
                    {getGame(selectedGameForDlc)?.platforms?.includes('console') && (
                        <div className="flex items-center justify-center gap-4 mt-4">
                            <span className="text-sm font-medium text-gray-600">Default Platform:</span>
                            <div className="flex items-center space-x-2">
                                <span className={`text-sm font-medium transition-colors ${platformPreference === 'console' ? 'text-gray-400' : 'text-blue-600'}`}>PC</span>
                                <div
                                    onClick={handlePlatformPreferenceChange}
                                    className={`relative w-14 h-8 flex items-center rounded-full cursor-pointer p-1 transition-colors duration-300 ${platformPreference === 'pc' ? 'bg-blue-500' : 'bg-green-500'}`}
                                >
                                    <div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${platformPreference === 'pc' ? 'translate-x-0' : 'translate-x-6'}`}></div>
                                </div>
                                <span className={`text-sm font-medium transition-colors ${platformPreference === 'pc' ? 'text-gray-400' : 'text-green-600'}`}>Console</span>
                            </div>
                        </div>
                    )}

                    <div className="mt-4 p-4 border rounded-lg max-h-72 overflow-y-auto">
                        <h4 className="font-bold text-gray-700 mb-2">Owned DLCs for {TABS.find(t => t.id === selectedGameForDlc)?.name}</h4>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {(allDlcs[selectedGameForDlc] || []).map(dlc => (
                                <label key={dlc} className="flex items-center text-gray-700 p-2 rounded-md hover:bg-gray-50 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                                        checked={ownedDlcsForSelectedGame.includes(dlc)}
                                        onChange={() => handleDlcChange(dlc)}
                                    />
                                    <span className="ml-3">{dlc}</span>
                                </label>
                            ))}
                        </div>
                         {(allDlcs[selectedGameForDlc] || []).length === 0 && (
                            <p className="text-center text-gray-400">No DLCs listed for this game yet.</p>
                        )}
                    </div>
                </div>

                <div className="flex space-x-4 pt-4">
                    <button type="submit" disabled={loading} className={`w-full ${color.bg} ${color.hoverBg} text-white font-bold py-3 px-4 rounded-lg disabled:opacity-50 transition-colors`}>
                        {loading ? 'Saving...' : 'Save Changes'}
                    </button>
                     <button type="button" onClick={() => navigate(`/profile/${user.uid}`)} className="w-full bg-gray-500 hover:bg-gray-600 text-white font-bold py-3 px-4 rounded-lg transition-colors">
                        Cancel
                    </button>
                </div>
            </form>
        </div>
    );
};

export default EditProfilePage;