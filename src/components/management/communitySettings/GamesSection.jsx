import React, { useState } from 'react';
import { db } from '../../../firebase/config';
import { doc, updateDoc } from 'firebase/firestore';
import { getGameColor } from '../../../utils/helpers';
import { getEnabledGameIds } from '../../../utils/gamesRegistry';
import useGames from '../../../hooks/useGames';
import { SectionCard, Field, SaveBar, inputClass } from './ui';
import { scheduleDataRefresh } from '../../../utils/appRefresh';

// Which games can be submitted, and which one is the default on the community page.
const GamesSection = ({ community, setModalMessage }) => {
  const ALL_GAMES = useGames();
  const [allowedGames, setAllowedGames] = useState(community.allowedGames || getEnabledGameIds());
  const [mainGame, setMainGame] = useState(community.mainGame || '');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleGameToggle = (gameId) => {
    setDirty(true);
    setAllowedGames((prev) => {
      if (prev.includes(gameId)) {
        if (prev.length === 1) {
          setModalMessage('A community must have at least one game enabled.');
          return prev;
        }
        if (mainGame === gameId) setMainGame('');
        return prev.filter((g) => g !== gameId);
      }
      return [...prev, gameId];
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateDoc(doc(db, 'communitys', community.id), { allowedGames, mainGame });
      setModalMessage('Changes saved successfully!');
      scheduleDataRefresh();
      setDirty(false);
    } catch (error) {
      setModalMessage(`Error saving changes: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const allowedGamesForSelection = ALL_GAMES.filter((game) => allowedGames.includes(game.id));

  return (
    <SectionCard title="Games" description="Allowed games and your community's main game.">
      <Field
        label="Allowed Games"
        hint="Select which games can be submitted to this community. At least one must be selected."
      >
        <div className="flex items-center bg-gray-200 rounded-full p-1 shadow-inner overflow-x-auto">
          {ALL_GAMES.map((game) => {
            const isActive = allowedGames.includes(game.id);
            const color = getGameColor(game.id);
            return (
              <button
                key={game.id}
                type="button"
                onClick={() => handleGameToggle(game.id)}
                style={color.style}
                className={`flex-1 py-2 px-2 text-center rounded-full transition-all duration-300 font-semibold text-sm whitespace-nowrap
                  ${isActive ? `${color.bg} text-white shadow` : 'bg-transparent text-gray-500 hover:bg-gray-300'}`}
              >
                {game.name}
              </button>
            );
          })}
        </div>
      </Field>

      <Field
        label="Main Community Game"
        hint="This will be the default game selected when users visit your community page."
      >
        <select
          value={mainGame}
          onChange={(e) => {
            setMainGame(e.target.value);
            setDirty(true);
          }}
          className={`${inputClass} bg-white`}
        >
          <option value="">-- Select a Main Game --</option>
          {allowedGamesForSelection.map((game) => (
            <option key={game.id} value={game.id}>{game.name}</option>
          ))}
        </select>
      </Field>

      <SaveBar dirty={dirty} saving={saving} onSave={handleSave} />
    </SectionCard>
  );
};

export default GamesSection;
