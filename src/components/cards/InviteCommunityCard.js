import React, { useState } from 'react';
import {
  acceptCommunityInvite,
  declineCommunityInvite,
} from '../../firebase/community';
import CommunityCard from './CommunityCard';

const InviteCommunityCard = ({ invitation, community, userId, setModalMessage }) => {
  const [processingAction, setProcessingAction] = useState(null);

  const handleAccept = async () => {
    setProcessingAction('accept');
    try {
      await acceptCommunityInvite(invitation, userId);
      setModalMessage(`You joined ${community?.name || 'the community'}.`);
    } catch (error) {
      setModalMessage(`Could not accept invitation: ${error.message}`);
    } finally {
      setProcessingAction(null);
    }
  };

  const handleDeny = async () => {
    setProcessingAction('deny');
    try {
      await declineCommunityInvite(invitation.communityId, userId);
      setModalMessage('Invitation denied.');
    } catch (error) {
      setModalMessage(`Could not deny invitation: ${error.message}`);
    } finally {
      setProcessingAction(null);
    }
  };

  return (
    <div
      className="rounded-xl overflow-hidden shadow-md bg-white dark:bg-gray-800 flex flex-col h-full"
      aria-busy={processingAction !== null}
    >
      {community ? (
        <CommunityCard community={community} />
      ) : (
        <div className="p-6">
          <h3 className="font-bold text-xl text-gray-800 dark:text-gray-100">
            Community unavailable
          </h3>
          <p className="text-sm text-gray-500 mt-2">
            The community may have been removed since this invitation was sent.
          </p>
        </div>
      )}
      <div className="p-4 border-t border-gray-200 dark:border-gray-700 flex gap-3 mt-auto">
        <button
          type="button"
          onClick={handleDeny}
          disabled={processingAction !== null}
          className="flex-1 py-2 rounded-lg bg-red-100 hover:bg-red-200 text-red-700 dark:bg-red-900/40 dark:hover:bg-red-900/60 dark:text-red-200 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {processingAction === 'deny' ? 'Denying...' : 'Deny'}
        </button>
        <button
          type="button"
          onClick={handleAccept}
          disabled={processingAction !== null || !community}
          className="flex-1 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {processingAction === 'accept' ? 'Accepting...' : 'Accept'}
        </button>
      </div>
    </div>
  );
};

export default InviteCommunityCard;
