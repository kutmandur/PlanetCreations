import React, { useState, useRef } from 'react';
import { scheduleDataRefresh } from '../../../utils/appRefresh';
import { db } from '../../../firebase/config';
import { doc, updateDoc } from 'firebase/firestore';
import { ICONS } from '../../../utils/helpers';
import Icon from '../../ui/Icon';
import InfoBox from '../../ui/InfoBox';
import { SectionCard, SaveBar, getTextColorForBackground } from './ui';
import RankPermissionsEditor, {
  FixedRankPermissionsInfo,
} from '../../community/RankPermissionsEditor';
import {
  getRankPermissionFields,
  withDefaultRankPermissions,
} from '../../../utils/communityPermissions';

const GRAB_HANDLE_ICON = 'M3.75 6.75h16.5M3.75 12h16.5m-16.5 5.25h16.5';

// Owner & Moderator are fixed ranks; custom ranks are reorderable and Discord-linkable.
const RanksSection = ({ community, setModalMessage }) => {
  const suggestedRanks = community.discordRoles || [];

  const initialCustom =
    community.ranks?.filter((r) => r.name !== 'Owner' && r.name !== 'Moderator').sort((a, b) => a.weight - b.weight) || [];

  const [ranks, setRanks] = useState(
    initialCustom.length > 0
      ? initialCustom.map(withDefaultRankPermissions)
      : [withDefaultRankPermissions({ name: 'Member', color: '#6B7280', imageUrl: '', discordRoleId: '' })]
  );
  const [defaultRankIndex, setDefaultRankIndex] = useState(() => {
    const index = (initialCustom.length > 0 ? initialCustom : [{ name: 'Member' }]).findIndex(
      (r) => r.name === community.defaultRankName
    );
    return index > -1 ? index : 0;
  });
  const [ownerRankData, setOwnerRankData] = useState(
    community.ranks?.find((r) => r.name === 'Owner') || { name: 'Owner', color: '#EF4444', imageUrl: '' }
  );
  const [moderatorRankData, setModeratorRankData] = useState(
    withDefaultRankPermissions(community.ranks?.find((r) => r.name === 'Moderator') || {
      name: 'Moderator',
      color: '#3B82F6',
      imageUrl: '',
      discordRoleId: '',
    }, 'moderator')
  );

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const dragItem = useRef(null);
  const dragOverItem = useRef(null);

  const usedRoleIds = new Set(
    [moderatorRankData.discordRoleId, ...ranks.map((r) => r.discordRoleId)].filter(Boolean)
  );

  const touch = () => setDirty(true);

  const handleRankChange = (index, field, value) => {
    const newRanks = [...ranks];
    newRanks[index][field] = value;
    setRanks(newRanks);
    touch();
  };

  const handleOwnerRankChange = (field, value) => {
    setOwnerRankData((prev) => ({ ...prev, [field]: value }));
    touch();
  };

  const handleModeratorRankChange = (field, value) => {
    setModeratorRankData((prev) => ({ ...prev, [field]: value }));
    touch();
  };

  const addRank = (name = '', color = '#4F46E5', discordRoleId = '') => {
    if (ranks.length < 90) {
      setRanks([...ranks, withDefaultRankPermissions({ name, color, imageUrl: '', discordRoleId })]);
      touch();
    }
  };

  const removeRank = (index) => {
    if (ranks.length <= 1) {
      setModalMessage('You must have at least one custom rank.');
      return;
    }
    if (index === defaultRankIndex) setDefaultRankIndex(0);
    else if (index < defaultRankIndex) setDefaultRankIndex((prev) => prev - 1);
    setRanks(ranks.filter((_, i) => i !== index));
    touch();
  };

  const handleRankSort = () => {
    const _ranks = [...ranks];
    const draggedItemContent = _ranks.splice(dragItem.current, 1)[0];
    _ranks.splice(dragOverItem.current, 0, draggedItemContent);
    dragItem.current = null;
    dragOverItem.current = null;
    setRanks(_ranks);
    touch();
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const specialRanks = [
        { ...ownerRankData, name: 'Owner', weight: 0, discordRoleId: '' },
        {
          ...moderatorRankData,
          ...getRankPermissionFields(moderatorRankData, 'moderator'),
          name: 'Moderator',
          weight: 1,
        },
      ];
      const customRanksToSave = ranks
        .filter((r) => r.name.trim() !== '')
        .map((rank, index) => ({
          name: rank.name,
          color: rank.color,
          imageUrl: rank.imageUrl || '',
          discordRoleId: rank.discordRoleId || '',
          ...getRankPermissionFields(rank),
          weight: specialRanks.length + index,
        }));
      const ranksToSave = [...specialRanks, ...customRanksToSave];
      const defaultRankName = ranks[defaultRankIndex]?.name || 'Member';

      await updateDoc(doc(db, 'communitys', community.id), { ranks: ranksToSave, defaultRankName });
      setModalMessage('Ranks saved successfully!');
      scheduleDataRefresh();
      setDirty(false);
    } catch (error) {
      setModalMessage(`Error saving changes: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard title="Ranks & Permissions" description="'Owner' and 'Moderator' are fixed ranks with different management permissions. You can add and reorder custom ranks below them.">
      <div className="p-4 bg-blue-50 border-l-4 border-blue-400 text-blue-800 rounded-r-lg text-sm space-y-2">
        <p>
          Ranks are the roles members can hold in your community. Each rank has a name, color and optional image,
          and the order here defines seniority (higher = more senior). The <strong>Default Rank</strong> is the one
          new members receive automatically.
        </p>
        <p>
          <strong>Linking to Discord:</strong> once you've connected a Discord server in the{' '}
          <strong>Discord</strong> section, its roles are synced and appear both as quick-add chips below and in each
          rank's "Link to Discord Role" dropdown. Pick a Discord role for a rank and the bot keeps them in sync — a
          member with that Discord role automatically gets the matching rank here. Leave the dropdown empty to manage
          a rank purely inside PlanetCreations.
        </p>
      </div>

      {suggestedRanks.length > 0 && (
        <div>
          <h4 className="font-bold text-sm text-gray-600 mb-2">Synced Ranks from Discord:</h4>
          <div className="flex flex-wrap gap-2">
            {suggestedRanks
              .filter((rank) => !usedRoleIds.has(rank.id))
              .map((rank) => (
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

      <div className="space-y-3">
        {/* Fixed: Owner */}
        <div className="p-2 bg-gray-200 rounded-lg">
          <div className="flex items-center space-x-2">
            <div className="text-gray-400"><Icon path={ICONS.lockClosed} className="w-5 h-5" /></div>
            <input type="text" value="Owner" disabled className="w-full p-2 border rounded-lg bg-gray-100" />
            <input
              type="color"
              value={ownerRankData.color}
              onChange={(e) => handleOwnerRankChange('color', e.target.value)}
              className="h-10 w-12 p-1 border rounded-lg cursor-pointer"
            />
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
            <div className="mt-2">
              <FixedRankPermissionsInfo role="owner" />
            </div>
          </div>
        </div>

        {/* Fixed: Moderator */}
        <div className="p-2 bg-gray-100 rounded-lg border">
          <div className="flex items-center space-x-2">
            <div className="text-gray-400"><Icon path={ICONS.lockClosed} className="w-5 h-5" /></div>
            <input type="text" value="Moderator" disabled className="w-full p-2 border rounded-lg bg-gray-100" />
            <input
              type="color"
              value={moderatorRankData.color}
              onChange={(e) => handleModeratorRankChange('color', e.target.value)}
              className="h-10 w-12 p-1 border rounded-lg cursor-pointer"
            />
          </div>
          <div className="flex items-center gap-2 w-full mt-2 pl-7">
            <select
              value={moderatorRankData.discordRoleId}
              onChange={(e) => handleModeratorRankChange('discordRoleId', e.target.value)}
              className="w-full p-2 border rounded-lg bg-white"
              disabled={!suggestedRanks.length}
            >
              <option value="">Link to Discord Role...</option>
              {suggestedRanks.map((role) => (
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
          <div className="mt-2 pl-7">
            <RankPermissionsEditor
              rank={moderatorRankData}
              role="moderator"
              onChange={handleModeratorRankChange}
            />
          </div>
        </div>

        {/* Custom ranks */}
        {ranks.map((rank, index) => {
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
              <div className="flex-grow space-y-2">
                <div className="flex items-center space-x-2">
                  <input
                    type="text"
                    placeholder="Custom Rank Name"
                    value={rank.name}
                    onChange={(e) => handleRankChange(index, 'name', e.target.value)}
                    className="flex-grow p-2 border rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setDefaultRankIndex(index);
                      touch();
                    }}
                    title="Set as default rank for new members"
                    className={`h-10 px-3 flex items-center justify-center rounded-lg text-xs font-semibold whitespace-nowrap ${
                      isDefault ? 'bg-yellow-400 text-white' : 'bg-gray-200 text-gray-600 hover:bg-gray-300'
                    }`}
                  >
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
                    {suggestedRanks.map((role) => (
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
                <RankPermissionsEditor
                  rank={rank}
                  onChange={(field, value) => handleRankChange(index, field, value)}
                />
              </div>
              <div className="flex flex-col space-y-2 flex-shrink-0">
                <input
                  type="color"
                  value={rank.color}
                  onChange={(e) => handleRankChange(index, 'color', e.target.value)}
                  className="h-10 w-12 p-1 border rounded-lg cursor-pointer flex-shrink-0"
                />
                <button
                  type="button"
                  onClick={() => removeRank(index)}
                  disabled={ranks.length <= 1}
                  className="h-10 w-12 flex items-center justify-center text-white bg-red-500 hover:bg-red-600 rounded-lg font-bold text-xl disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  &times;
                </button>
              </div>
            </div>
          );
        })}
        <button type="button" onClick={() => addRank()} className="text-sm text-blue-500 hover:underline">
          Add custom rank
        </button>
      </div>

      <SaveBar dirty={dirty} saving={saving} onSave={handleSave} label="Save Ranks & Permissions" />
    </SectionCard>
  );
};

export default RanksSection;
