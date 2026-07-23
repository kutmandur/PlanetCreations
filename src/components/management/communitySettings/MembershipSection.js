import React, { useState } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../../../firebase/config';
import {
  clearCommunityJoinPassword,
  setCommunityJoinPassword,
} from '../../../firebase/community';
import { Field, inputClass, SaveBar, SectionCard } from './ui';

const JOIN_MODES = [
  {
    id: 'open',
    label: 'Open',
    description: 'Anyone who is signed in can join immediately.',
  },
  {
    id: 'application',
    label: 'Application',
    description: 'Community staff review each request before the user becomes a member.',
  },
  {
    id: 'password',
    label: 'Password',
    description: 'Users must enter the community password. The password is never exposed to clients.',
  },
  {
    id: 'invite',
    label: 'Invite only',
    description: 'Only users with a current invitation can join.',
  },
];

const MembershipSection = ({ community, setModalMessage }) => {
  const [joinMode, setJoinMode] = useState(community.joinMode || 'open');
  const [allowApplicationMessage, setAllowApplicationMessage] = useState(
    community.allowApplicationMessage === true
  );
  const [membersOnlyInfoPage, setMembersOnlyInfoPage] = useState(
    community.membersOnlyInfoPage === true
  );
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(community.hasJoinPassword === true);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSave = async () => {
    if (joinMode === 'password' && !hasPassword && password.length < 6) {
      setModalMessage('Set a password with at least 6 characters before enabling password joining.');
      return;
    }

    setSaving(true);
    try {
      if (joinMode === 'password' && password) {
        await setCommunityJoinPassword(community.id, password);
        setHasPassword(true);
        setPassword('');
      }
      await updateDoc(doc(db, 'communitys', community.id), {
        joinMode,
        allowApplicationMessage,
        membersOnlyInfoPage,
      });
      setDirty(false);
      setModalMessage('Membership settings saved.');
    } catch (error) {
      setModalMessage(`Could not save membership settings: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  const handleClearPassword = async () => {
    setSaving(true);
    try {
      await clearCommunityJoinPassword(community.id);
      setHasPassword(false);
      setPassword('');
      setJoinMode('open');
      setDirty(false);
      setModalMessage('The join password was removed. Joining is open again.');
    } catch (error) {
      setModalMessage(`Could not remove the password: ${error.message}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <SectionCard
      title="Membership"
      description="Choose how new members are allowed to join this community."
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {JOIN_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => {
              setJoinMode(mode.id);
              setDirty(true);
            }}
            className={`p-4 rounded-xl border-2 text-left transition ${
              joinMode === mode.id
                ? 'border-[--theme-color] bg-gray-50 dark:bg-gray-700'
                : 'border-gray-200 hover:border-gray-300 dark:border-gray-600'
            }`}
          >
            <span className="block font-bold text-gray-800 dark:text-gray-100">{mode.label}</span>
            <span className="block mt-1 text-sm text-gray-500 dark:text-gray-400">
              {mode.description}
            </span>
          </button>
        ))}
      </div>

      {joinMode === 'application' && (
        <label className="flex items-start gap-3 p-4 rounded-xl bg-gray-50 dark:bg-gray-700">
          <input
            type="checkbox"
            checked={allowApplicationMessage}
            onChange={(event) => {
              setAllowApplicationMessage(event.target.checked);
              setDirty(true);
            }}
            className="mt-1 h-4 w-4 rounded border-gray-300"
          />
          <span>
            <span className="block font-semibold text-gray-800 dark:text-gray-100">
              Allow an application message
            </span>
            <span className="block text-sm text-gray-500 dark:text-gray-400">
              Applicants can add up to 1,000 characters for your staff.
            </span>
          </span>
        </label>
      )}

      {joinMode === 'password' && (
        <Field
          label={hasPassword ? 'Replace join password' : 'Set join password'}
          hint={hasPassword
            ? 'Leave this blank to keep the existing password.'
            : 'Use at least 6 characters.'}
        >
          <input
            type="password"
            value={password}
            minLength={6}
            maxLength={128}
            autoComplete="new-password"
            onChange={(event) => {
              setPassword(event.target.value);
              setDirty(true);
            }}
            className={inputClass}
          />
          {hasPassword && (
            <button
              type="button"
              onClick={handleClearPassword}
              disabled={saving}
              className="mt-3 text-sm font-semibold text-red-600 hover:text-red-700 disabled:opacity-50"
            >
              Remove password and switch to open joining
            </button>
          )}
        </Field>
      )}

      <div className="border-t border-gray-200 dark:border-gray-700 pt-5">
        <label className="flex items-start gap-3 p-4 rounded-xl bg-gray-50 dark:bg-gray-700">
          <input
            type="checkbox"
            checked={membersOnlyInfoPage}
            onChange={(event) => {
              setMembersOnlyInfoPage(event.target.checked);
              setDirty(true);
            }}
            className="mt-1 h-4 w-4 rounded border-gray-300"
          />
          <span>
            <span className="block font-semibold text-gray-800 dark:text-gray-100">
              Members-only community info page
            </span>
            <span className="block text-sm text-gray-500 dark:text-gray-400">
              Non-members can still discover and join this community, but opening its
              community info page only shows an access screen.
            </span>
          </span>
        </label>
      </div>

      <SaveBar dirty={dirty} saving={saving} onSave={handleSave} />
    </SectionCard>
  );
};

export default MembershipSection;
