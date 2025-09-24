import React, { useState, useRef, useEffect } from 'react';
import { db, auth } from '../../firebase/config';
import { doc, updateDoc, collection, query, where, getDocs, documentId, writeBatch } from 'firebase/firestore';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { deleteCommunityAsAdmin } from '../../firebase/community';
import Spinner from '../ui/Spinner';
import { containsBlacklistedWord, ICONS } from '../../utils/helpers';
import Icon from '../ui/Icon';
import InfoBox from '../ui/InfoBox';

const API_BASE_URL = "https://us-central1-planetcreationsdotnet.cloudfunctions.net/api";

const EditCommunityForm = ({ communityToEdit, setView, setModalMessage, setPasswordConfirm, onCancel, blacklist, userProfile }) => {
  const [name, setName] = useState(communityToEdit.name || '');
  const [description, setDescription] = useState(communityToEdit.description || '');
  const [bannerImageUrl, setBannerImageUrl] = useState(communityToEdit.bannerImageUrl || '');
  const [profileImageUrl, setProfileImageUrl] = useState(communityToEdit.profileImageUrl || '');
  // ❌ 1. Remove themeColor state
  const [discordServerId, setDiscordServerId] = useState(communityToEdit.discordServerId || '');
  const [suggestedRanks, setSuggestedRanks] = useState([]);
  const [isFetchingRanks, setIsFetchingRanks] = useState(false);
  const [isServerIdInputVisible, setIsServerIdInputVisible] = useState(!!communityToEdit.discordServerId);
  const isAdmin = userProfile?.role === 'admin';

  const customRanks =
    communityToEdit.ranks?.filter(r => r.name !== 'Owner' && r.name !== 'Moderator').sort((a, b) => a.weight - b.weight) || [];
  const [ranks, setRanks] = useState(
    customRanks.length > 0 ? customRanks : [{ name: 'Member', color: '#6B7280', imageUrl: '', discordRoleId: '' }]
  );

  const [defaultRankIndex, setDefaultRankIndex] = useState(() => {
    const defaultRankName = communityToEdit.defaultRankName;
    const index = ranks.findIndex(r => r.name === defaultRankName);
    return index > -1 ? index : 0;
  });

  const [ownerRankData, setOwnerRankData] = useState(
    communityToEdit.ranks?.find(r => r.name === 'Owner') || { name: 'Owner', color: '#EF4444', imageUrl: '' }
  );
  const [moderatorRankData, setModeratorRankData] = useState(
    communityToEdit.ranks?.find(r => r.name === 'Moderator') || {
      name: 'Moderator',
      color: '#3B82F6',
      imageUrl: '',
      discordRoleId: '',
    }
  );

  const [loading, setLoading] = useState(false);
  const dragItem = useRef(null);
  const dragOverItem = useRef(null);
  
  const GRAB_HANDLE_ICON = "M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5";

  const slugify = (text) => {
    return text.toString().toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^\w\-]+/g, '')
        .replace(/\-\-+/g, '-')
        .replace(/^-+/, '')
        .replace(/-+$/, '');
  };

  useEffect(() => {
    if (discordServerId) {
      fetchDiscordRanks(true);
    }
  }, [discordServerId]);

  const handleRankChange = (index, field, value) => {
    const newRanks = [...ranks];
    newRanks[index][field] = value;
    setRanks(newRanks);
  };

  const handleOwnerRankChange = (field, value) => {
    setOwnerRankData(prev => ({ ...prev, [field]: value }));
  };

  const handleModeratorRankChange = (field, value) => {
    setModeratorRankData(prev => ({ ...prev, [field]: value }));
  };

  const addRank = (name = '', color = '#4F46E5', discordRoleId = '') => {
    if (ranks.length < 90) {
      setRanks([...ranks, { name, color, imageUrl: '', discordRoleId }]);
    }
  };

  const removeRank = index => {
    if (ranks.length <= 1) {
      setModalMessage('You must have at least one custom rank.');
      return;
    }
    if (index === defaultRankIndex) {
      setDefaultRankIndex(0);
    } else if (index < defaultRankIndex) {
      setDefaultRankIndex(prev => prev - 1);
    }
    setRanks(ranks.filter((_, i) => i !== index));
  };

  const handleRankSort = () => {
    let _ranks = [...ranks];
    const draggedItemContent = _ranks.splice(dragItem.current, 1)[0];
    _ranks.splice(dragOverItem.current, 0, draggedItemContent);
    dragItem.current = null;
    dragOverItem.current = null;
    setRanks(_ranks);
  };

  const fetchDiscordRanks = async (isSilent = false) => {
    if (!discordServerId) {
      if (!isSilent) setModalMessage('Please enter a Discord Server ID.');
      return;
    }
    setIsFetchingRanks(true);

    try {
      const response = await fetch(`${API_BASE_URL}/getDiscordRoles?serverId=${discordServerId}`);
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch ranks: ${errorText}`);
      }
      const fetchedRanks = await response.json();
      setSuggestedRanks(fetchedRanks);
    } catch (error) {
      console.error('Error fetching Discord ranks:', error);
      if (!isSilent) setModalMessage(error.message);
    } finally {
      setIsFetchingRanks(false);
    }
  };

  const getTextColorForBackground = hexColor => {
    if (!hexColor || hexColor === '#000000') return '#ffffff';
    const r = parseInt(hexColor.substr(1, 2), 16);
    const g = parseInt(hexColor.substr(3, 2), 16);
    const b = parseInt(hexColor.substr(5, 2), 16);
    const yiq = (r * 299 + g * 587 + b * 114) / 1000;
    return yiq >= 128 ? '#000000' : '#ffffff';
  };

  const handleSubmit = e => {
    e.preventDefault();
    if (containsBlacklistedWord(name, blacklist) || containsBlacklistedWord(description, blacklist)) {
        setModalMessage('Community name or description contains a forbidden word.');
        return;
    }

    setPasswordConfirm({
      message: 'To save changes to your community, please confirm with your password.',
      onConfirm: async password => {
        setLoading(true);
        const user = auth.currentUser;

        if (discordServerId) {
            const q = query(
                collection(db, 'communitys'), 
                where("discordServerId", "==", discordServerId),
                where(documentId(), "!=", communityToEdit.id)
            );
            const querySnapshot = await getDocs(q);
            if (!querySnapshot.empty) {
                setModalMessage("This Discord server is already linked to another community.");
                setLoading(false);
                return;
            }
        }

        try {
          const credential = EmailAuthProvider.credential(user.email, password);
          await reauthenticateWithCredential(user, credential);
          
          const batch = writeBatch(db);
          const communityRef = doc(db, 'communitys', communityToEdit.id);

          const specialRanks = [
            { ...ownerRankData, name: 'Owner', weight: 0, discordRoleId: '' },
            { ...moderatorRankData, name: 'Moderator', weight: 1 },
          ];

          const customRanksToSave = ranks
            .filter(r => r.name.trim() !== '')
            .map((rank, index) => ({
              name: rank.name,
              color: rank.color,
              imageUrl: rank.imageUrl || '',
              discordRoleId: rank.discordRoleId || '',
              weight: specialRanks.length + index,
            }));

          const ranksToSave = [...specialRanks, ...customRanksToSave];
          const defaultRankName = ranks[defaultRankIndex]?.name || 'Member';
          
          const updateData = {
            description,
            bannerImageUrl,
            profileImageUrl,
            // ❌ 2. Remove themeColor from the update object
            ranks: ranksToSave,
            defaultRankName,
            discordServerId,
          };
          
          if (!communityToEdit.slug) {
            updateData.slug = slugify(communityToEdit.name);
          }

          const nameChanged = isAdmin && name.trim() !== communityToEdit.name;
          if (nameChanged) {
            updateData.name = name.trim();
            updateData.slug = slugify(name.trim());
          }

          batch.update(communityRef, updateData);

          if (nameChanged) {
            const membersQuery = query(collection(db, 'communitys', communityToEdit.id, 'members'));
            const membersSnapshot = await getDocs(membersQuery);
            membersSnapshot.forEach(memberDoc => {
                const userMembershipRef = doc(db, 'profiles', memberDoc.id, 'communityMemberships', communityToEdit.id);
                batch.update(userMembershipRef, { communityName: name.trim() });
            });
          }

          await batch.commit();

          setModalMessage('Community updated successfully!');
          onCancel();
        } catch (error) {
          setModalMessage(`Error updating community: ${error.message}`);
        } finally {
          setLoading(false);
        }
      },
    });
  };

  const handleDelete = () => {
    setPasswordConfirm({
      message: `To permanently delete the "${communityToEdit.name}" community, please confirm with your password. This action cannot be undone.`,
      onConfirm: async password => {
        setLoading(true);
        const user = auth.currentUser;
        try {
          const credential = EmailAuthProvider.credential(user.email, password);
          await reauthenticateWithCredential(user, credential);

          await deleteCommunityAsAdmin(communityToEdit.id);

          setModalMessage('Community has been permanently deleted.');
          setView({ name: 'communitys' });
        } catch (error) {
          setModalMessage(`Error deleting community: ${error.message}`);
        } finally {
          setLoading(false);
        }
      },
    });
  };

  return (
    <div className="max-w-4xl mx-auto mt-10 p-8 bg-white rounded-lg shadow-lg">
      <h1 className="text-3xl font-bold text-center mb-6">Edit Community: {communityToEdit.name}</h1>
      <form onSubmit={handleSubmit} className="space-y-8">
        <div>
          <label className="block text-gray-700 font-bold mb-2">
            {isAdmin ? 'Community Name (Editable by Admins)' : 'Community Name (Cannot be changed)'}
          </label>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} disabled={!isAdmin} className={`w-full p-3 border rounded-lg ${!isAdmin ? 'bg-gray-100' : ''}`} />
        </div>
        <div>
          <label className="block text-gray-700 font-bold mb-2">Description</label>
          <textarea
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows="4"
            className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          ></textarea>
        </div>
        <div>
          <label className="block text-gray-700 font-bold mb-2">Banner Image URL</label>
          <input
            type="url"
            value={bannerImageUrl}
            onChange={e => setBannerImageUrl(e.target.value)}
            className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="https://..."
          />
          <div className="mt-2"><InfoBox /></div>
        </div>
        <div>
          <label className="block text-gray-700 font-bold mb-2">Profile Image URL (Square)</label>
          <input
            type="url"
            value={profileImageUrl}
            onChange={e => setProfileImageUrl(e.target.value)}
            className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="https://..."
          />
          <div className="mt-2"><InfoBox /></div>
        </div>
        
        {/* ❌ 3. Remove the theme color div from the JSX */}

        <div>
          <h3 className="text-xl font-bold text-gray-800 border-b pb-2 mb-4">Discord Integration</h3>
          {/* ... Discord Integration JSX remains the same ... */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                        <a
              href="https://discord.com/oauth2/authorize?client_id=1407474623511269427&permissions=268435456&integration_type=0&scope=bot"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg text-center"
            >
              Invite Bot
            </a>
            <button
              type="button"
              onClick={() => setIsServerIdInputVisible(!isServerIdInputVisible)}
              className={`${
                discordServerId ? 'bg-green-500 hover:bg-green-600' : 'bg-indigo-500 hover:bg-indigo-600'
              } text-white font-bold py-2 px-4 rounded-lg`}
            >
              {discordServerId ? 'Server ID Linked' : 'Link Server ID'}
            </button>
            <button
              type="button"
              onClick={() => fetchDiscordRanks(false)}
              disabled={isFetchingRanks || !discordServerId}
              className="bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2 px-4 rounded-lg transition-colors disabled:opacity-75"
            >
              {isFetchingRanks ? <Spinner /> : 'Import Ranks'}
            </button>
          </div>
          {isServerIdInputVisible && (
            <div className="mt-2">
              <input
                type="text"
                value={discordServerId}
                onChange={e => setDiscordServerId(e.target.value)}
                className="w-full p-3 border rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
                placeholder="Paste your Discord Server ID here..."
              />
            </div>
          )}
          {suggestedRanks.length > 0 && (
            <div className="mt-4">
              <h4 className="font-bold text-sm text-gray-600 mb-2">Suggested Ranks from Discord:</h4>
              <div className="flex flex-wrap gap-2">
                {suggestedRanks.map(rank => (
                  <button
                    key={rank.id}
                    type="button"
                    onClick={() => addRank(rank.name, rank.color, rank.id)}
                    className="text-sm font-medium py-1 px-3 rounded-full"
                    style={{ backgroundColor: rank.color, color: getTextColorForBackground(rank.color) }}
                  >
                    + {rank.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div>
            <h3 className="text-xl font-bold text-gray-800 border-b pb-2 mb-4">Community Ranks</h3>
             {/* ... Ranks JSX remains the same ... */}
            <div className="p-3 mb-4 bg-blue-50 border-l-4 border-blue-400 text-blue-800 rounded-r-lg">
                <p className="text-sm">'Owner' and 'Moderator' are fixed ranks. You can add and reorder custom ranks below them.</p>
            </div>
            <div className="space-y-3">
                <div className="p-2 bg-gray-200 rounded-lg">
                    <div className="flex items-center space-x-2">
                        <div className="text-gray-400"><Icon path={ICONS.lockClosed} className="w-5 h-5" /></div>
                        <input type="text" value="Owner" disabled className="w-full p-2 border rounded-lg bg-gray-100" />
                        <input type="color" value={ownerRankData.color} onChange={(e) => handleOwnerRankChange('color', e.target.value)} className="h-10 w-12 p-1 border rounded-lg cursor-pointer" />
                    </div>
                    <div className="w-full mt-2 pl-7">
                        <input 
                            type="url" 
                            placeholder="Image URL..." 
                            value={ownerRankData.imageUrl} 
                            onChange={(e) => handleOwnerRankChange('imageUrl', e.target.value)} 
                            className="w-full p-2 border rounded-lg"
                        />
                        <div className="mt-2"><InfoBox /></div>
                    </div>
                </div>
                <div className="p-2 bg-gray-100 rounded-lg border">
                    <div className="flex items-center space-x-2">
                        <div className="text-gray-400"><Icon path={ICONS.lockClosed} className="w-5 h-5" /></div>
                        <input type="text" value="Moderator" disabled className="w-full p-2 border rounded-lg bg-gray-100" />
                        <input type="color" value={moderatorRankData.color} onChange={(e) => handleModeratorRankChange('color', e.target.value)} className="h-10 w-12 p-1 border rounded-lg cursor-pointer" />
                    </div>
                    <div className="flex items-center gap-2 w-full mt-2 pl-7">
                        <select 
                            value={moderatorRankData.discordRoleId} 
                            onChange={(e) => handleModeratorRankChange('discordRoleId', e.target.value)}
                            className="w-full p-2 border rounded-lg bg-white"
                            disabled={!suggestedRanks.length}
                        >
                            <option value="">Link to Discord Role...</option>
                            {suggestedRanks.map(role => (
                                <option key={role.id} value={role.id}>{role.name}</option>
                            ))}
                        </select>
                        <input 
                            type="url" 
                            placeholder="Image URL..." 
                            value={moderatorRankData.imageUrl} 
                            onChange={(e) => handleModeratorRankChange('imageUrl', e.target.value)} 
                            className="w-full p-2 border rounded-lg"
                        />
                    </div>
                     <div className="mt-2 pl-7"><InfoBox /></div>
                </div>

                {ranks.map((rank, index) => {
                    const linkedRole = suggestedRanks.find(r => r.id === rank.discordRoleId);
                    const isDefault = index === defaultRankIndex;
                    return (
                        <div 
                            key={index} 
                            draggable
                            onDragStart={() => (dragItem.current = index)}
                            onDragEnter={() => (dragOverItem.current = index)}
                            onDragEnd={handleRankSort}
                            onDragOver={(e) => e.preventDefault()}
                            className="flex items-start space-x-2 p-2 bg-gray-50 rounded-lg border"
                        >
                            <div className="cursor-grab text-gray-400 pt-2.5"><Icon path={GRAB_HANDLE_ICON} className="w-5 h-5" /></div>
                            <div className='flex-grow space-y-2'>
                                <div className="flex items-center space-x-2">
                                    <input type="text" placeholder="Custom Rank Name" value={rank.name} onChange={(e) => handleRankChange(index, 'name', e.target.value)} className="flex-grow p-2 border rounded-lg" />
                                    <button type="button" onClick={() => setDefaultRankIndex(index)} title="Set as default rank for new members" className={`h-10 px-3 flex items-center justify-center rounded-lg text-xs font-semibold whitespace-nowrap ${isDefault ? 'bg-yellow-400 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'}`}>
                                        Default Rank
                                    </button>
                                </div>
                                <div className="flex items-center gap-2">
                                    <select 
                                        value={rank.discordRoleId || ''} 
                                        onChange={(e) => handleRankChange(index, 'discordRoleId', e.target.value)}
                                        className="w-full p-2 border rounded-lg bg-white"
                                        disabled={!suggestedRanks.length}
                                    >
                                        <option value="">Link to Discord Role...</option>
                                        {suggestedRanks.map(role => (
                                            <option key={role.id} value={role.id}>{role.name}</option>
                                        ))}
                                    </select>
                                    <input 
                                        type="url" 
                                        placeholder="Image URL..." 
                                        value={rank.imageUrl || ''} 
                                        onChange={(e) => handleRankChange(index, 'imageUrl', e.target.value)} 
                                        className="w-full p-2 border rounded-lg"
                                    />
                                </div>
                                 <div className="mt-2"><InfoBox /></div>
                                {linkedRole && <p className="text-xs text-gray-500 pl-1">Linked to: <span className="font-semibold" style={{color: linkedRole.color}}>{linkedRole.name}</span></p>}
                            </div>
                            <div className="flex flex-col space-y-2 flex-shrink-0">
                                <input type="color" value={rank.color} onChange={(e) => handleRankChange(index, 'color', e.target.value)} className="h-10 w-12 p-1 border rounded-lg cursor-pointer flex-shrink-0" />
                                <button type="button" onClick={() => removeRank(index)} disabled={ranks.length <= 1} className="h-10 w-12 flex items-center justify-center text-white bg-red-500 hover:bg-red-600 rounded-lg font-bold text-xl disabled:opacity-50 disabled:cursor-not-allowed">&times;</button>
                            </div>
                        </div>
                    );
                })}
                <button type="button" onClick={() => addRank()} className="text-sm text-blue-500 hover:underline">Add custom rank</button>
            </div>
        </div>

        <div className="flex justify-between items-center mt-8 pt-6 border-t">
          <div>
            <button
              type="button"
              onClick={handleDelete}
              className="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg transition-colors"
            >
              Delete Community
            </button>
          </div>
          <div className="flex space-x-4">
            <button
              type="button"
              onClick={onCancel}
              className="bg-gray-200 hover:bg-gray-300 text-gray-800 font-bold py-3 px-6 rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading}
              className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-3 px-6 rounded-lg disabled:opacity-50 transition-colors"
            >
              {loading ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default EditCommunityForm;