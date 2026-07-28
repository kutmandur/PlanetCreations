import React, { useState } from 'react';
import { db } from '../../../firebase/config';
import { doc, updateDoc, collection, query, where, getDocs, documentId } from 'firebase/firestore';
import { SectionCard, Field, SaveBar, inputClass } from './ui';
import { scheduleDataRefresh } from '../../../utils/appRefresh';

// Dropdown of the community's synced Discord text channels, with an "off" option.
const ChannelSelect = ({ channels, value, onChange }) => (
  <select value={value} onChange={(e) => onChange(e.target.value)} className={`${inputClass} bg-white`}>
    <option value="">— No notifications —</option>
    {channels.map((c) => (
      <option key={c.id} value={c.id}>#{c.name}</option>
    ))}
  </select>
);

// Link the community to a Discord server and choose which channels receive notifications.
const DiscordSection = ({ community, setModalMessage }) => {
  const channels = community.discordChannels || [];

  // --- Server linking ---
  const [discordServerId, setDiscordServerId] = useState(community.discordServerId || '');
  const [isServerIdInputVisible, setIsServerIdInputVisible] = useState(!!community.discordServerId);
  const [serverDirty, setServerDirty] = useState(false);
  const [serverSaving, setServerSaving] = useState(false);

  const handleSaveServer = async () => {
    setServerSaving(true);
    try {
      const id = discordServerId.trim();
      if (id) {
        const q = query(
          collection(db, 'communitys'),
          where('discordServerId', '==', id),
          where(documentId(), '!=', community.id)
        );
        const snapshot = await getDocs(q);
        if (!snapshot.empty) {
          setModalMessage('This Discord server is already linked to another community.');
          setServerSaving(false);
          return;
        }
      }
      await updateDoc(doc(db, 'communitys', community.id), { discordServerId: id });
      setModalMessage('Changes saved successfully!');
      scheduleDataRefresh();
      setServerDirty(false);
    } catch (error) {
      setModalMessage(`Error saving changes: ${error.message}`);
    } finally {
      setServerSaving(false);
    }
  };

  // --- Notification channels ---
  const [generalChannelId, setGeneralChannelId] = useState(community.discordGeneralChannelId || '');
  const [showcaseChannelId, setShowcaseChannelId] = useState(community.discordShowcaseChannelId || '');
  const [channelsDirty, setChannelsDirty] = useState(false);
  const [channelsSaving, setChannelsSaving] = useState(false);

  const handleSaveChannels = async () => {
    setChannelsSaving(true);
    try {
      await updateDoc(doc(db, 'communitys', community.id), {
        discordGeneralChannelId: generalChannelId || null,
        discordShowcaseChannelId: showcaseChannelId || null,
      });
      setModalMessage('Changes saved successfully!');
      scheduleDataRefresh();
      setChannelsDirty(false);
    } catch (error) {
      setModalMessage(`Error saving changes: ${error.message}`);
    } finally {
      setChannelsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <SectionCard title="Discord Server" description="Link your Discord server so the bot can sync roles and post notifications.">
        <Field hint="The bot automatically syncs roles and channels from your server. Link your server ID, then run /import-community-setup in your server so its channels appear below and in the Ranks section.">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <a
              href="https://discord.com/oauth2/authorize?client_id=1407474623511269427&permissions=268435456&integration_type=0&scope=bot"
              target="_blank"
              rel="noopener noreferrer"
              className="bg-indigo-500 hover:bg-indigo-600 text-white font-bold py-2.5 px-4 rounded-xl text-center"
            >
              Invite Bot
            </a>
            <button
              type="button"
              onClick={() => setIsServerIdInputVisible((v) => !v)}
              className={`${
                discordServerId ? 'bg-green-500 hover:bg-green-600' : 'bg-indigo-500 hover:bg-indigo-600'
              } text-white font-bold py-2.5 px-4 rounded-xl`}
            >
              {discordServerId ? 'Server ID Linked' : 'Link Server ID'}
            </button>
          </div>
          {isServerIdInputVisible && (
            <div className="mt-3">
              <input
                type="text"
                value={discordServerId}
                onChange={(e) => {
                  setDiscordServerId(e.target.value);
                  setServerDirty(true);
                }}
                className={inputClass}
                placeholder="Paste your Discord Server ID here..."
              />
            </div>
          )}
        </Field>

        <SaveBar dirty={serverDirty} saving={serverSaving} onSave={handleSaveServer} />
      </SectionCard>

      <SectionCard title="Notification Channels" description="Choose which Discord channels receive community notifications.">
        {channels.length === 0 ? (
          <p className="text-sm text-gray-500">
            No Discord channels found yet. Link your server above and run <code className="text-xs bg-gray-100 px-1 py-0.5 rounded">/import-community-setup</code> in
            your Discord server — the bot will sync your text channels here.
          </p>
        ) : (
          <>
            <Field
              label="General notifications"
              hint="Channel for creations added to your community that are not part of an event."
            >
              <ChannelSelect
                channels={channels}
                value={generalChannelId}
                onChange={(v) => {
                  setGeneralChannelId(v);
                  setChannelsDirty(true);
                }}
              />
            </Field>

            <Field
              label="Showcase notifications"
              hint="Channel where creations that get showcased are announced."
            >
              <ChannelSelect
                channels={channels}
                value={showcaseChannelId}
                onChange={(v) => {
                  setShowcaseChannelId(v);
                  setChannelsDirty(true);
                }}
              />
            </Field>

            <SaveBar dirty={channelsDirty} saving={channelsSaving} onSave={handleSaveChannels} />
          </>
        )}
      </SectionCard>
    </div>
  );
};

export default DiscordSection;
