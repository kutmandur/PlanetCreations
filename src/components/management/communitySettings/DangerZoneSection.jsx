import React, { useState } from 'react';
import { auth } from '../../../firebase/config';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { transferCommunityOwnership, deleteCommunityAsAdmin } from '../../../firebase/community';
import { SectionCard } from './ui';

// Irreversible actions: transfer ownership (owner only) and delete the community.
const DangerZoneSection = ({ community, members = [], isOwner, setModalMessage, setPasswordConfirm, onTransferComplete, onDeleted }) => {
  const meUid = auth.currentUser?.uid;
  const [transferTarget, setTransferTarget] = useState('');
  const transferCandidates = members.filter((m) => m.id !== meUid);

  const handleTransferOwnership = () => {
    if (!isOwner || !transferTarget) return;
    const target = members.find((m) => m.id === transferTarget);
    const targetName = target?.username || 'this member';
    setPasswordConfirm({
      message: `Transfer ownership of "${community.name}" to "${targetName}"? You will become a regular member. Confirm with your password.`,
      onConfirm: async (password) => {
        try {
          const u = auth.currentUser;
          await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
          await transferCommunityOwnership(community.id, transferTarget, meUid, community.defaultRankName);
          setModalMessage(`Ownership transferred to ${targetName}.`);
          if (onTransferComplete) onTransferComplete();
        } catch (error) {
          setModalMessage(`Error transferring ownership: ${error.message}`);
        }
      },
    });
  };

  const handleDelete = () => {
    setPasswordConfirm({
      message: `To permanently delete the "${community.name}" community, please confirm with your password. This action cannot be undone.`,
      onConfirm: async (password) => {
        try {
          const u = auth.currentUser;
          await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, password));
          await deleteCommunityAsAdmin(community.id);
          setModalMessage('Community has been permanently deleted.');
          if (onDeleted) onDeleted();
        } catch (error) {
          setModalMessage(`Error deleting community: ${error.message}`);
        }
      },
    });
  };

  return (
    <SectionCard title="Danger Zone" description="These actions are permanent and cannot be undone.">
      {isOwner && (
        <div className="p-4 rounded-xl border border-red-200 bg-red-50/50">
          <h4 className="font-bold text-gray-800 mb-1">Transfer Ownership</h4>
          <p className="text-sm text-gray-500 mb-3">
            Hand this community over to another member. The new owner gets full control; you will be demoted to a
            regular member. This cannot be undone by you.
          </p>
          <div className="flex items-center gap-3">
            <select
              value={transferTarget}
              onChange={(e) => setTransferTarget(e.target.value)}
              className="flex-grow p-2.5 border border-gray-300 rounded-xl bg-white"
            >
              <option value="">-- Select new owner --</option>
              {transferCandidates.map((m) => (
                <option key={m.id} value={m.id}>{m.username || m.id}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={handleTransferOwnership}
              disabled={!transferTarget}
              className="bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-4 rounded-xl disabled:opacity-50 whitespace-nowrap"
            >
              Transfer
            </button>
          </div>
          {transferCandidates.length === 0 && (
            <p className="text-sm text-gray-400 mt-2">No other members to transfer to yet.</p>
          )}
        </div>
      )}

      <div className="p-4 rounded-xl border border-red-200 bg-red-50/50">
        <h4 className="font-bold text-gray-800 mb-1">Delete Community</h4>
        <p className="text-sm text-gray-500 mb-3">
          Permanently deletes this community and all of its assignments. This action cannot be undone.
        </p>
        <button
          type="button"
          onClick={handleDelete}
          className="bg-red-600 hover:bg-red-700 text-white font-bold py-2.5 px-6 rounded-xl transition-colors"
        >
          Delete Community
        </button>
      </div>
    </SectionCard>
  );
};

export default DangerZoneSection;
