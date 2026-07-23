import React, { useEffect, useState } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { decideCommunityJoinRequest } from '../../firebase/community';
import Spinner from '../ui/Spinner';

const JoinRequestsManager = ({ community, setModalMessage }) => {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [processingId, setProcessingId] = useState(null);

  useEffect(() => {
    const unsubscribe = onSnapshot(
      collection(db, 'communitys', community.id, 'joinRequests'),
      snapshot => {
        setRequests(snapshot.docs
          .map(requestDoc => ({ id: requestDoc.id, ...requestDoc.data() }))
          .filter(request => request.status === 'pending')
          .sort((a, b) => {
            const aTime = a.createdAt?.seconds || 0;
            const bTime = b.createdAt?.seconds || 0;
            return aTime - bTime;
          }));
        setLoading(false);
      },
      error => {
        setModalMessage(`Could not load join requests: ${error.message}`);
        setLoading(false);
      }
    );
    return unsubscribe;
  }, [community.id, setModalMessage]);

  const decide = async (request, decision) => {
    setProcessingId(request.id);
    try {
      await decideCommunityJoinRequest(community.id, request.id, decision);
      setModalMessage(
        decision === 'approve'
          ? `${request.username} joined the community.`
          : `${request.username}'s request was declined.`
      );
    } catch (error) {
      setModalMessage(`Could not process the request: ${error.message}`);
    } finally {
      setProcessingId(null);
    }
  };

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner /></div>;
  }

  return (
    <div className="bg-white dark:bg-gray-800 p-6 rounded-2xl shadow-md">
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Join Requests</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Approving a request assigns the community's current default rank.
        </p>
      </div>

      {requests.length === 0 ? (
        <p className="py-12 text-center text-gray-500 dark:text-gray-400">
          There are no pending join requests.
        </p>
      ) : (
        <div className="space-y-4">
          {requests.map(request => (
            <article
              key={request.id}
              className="border border-gray-200 dark:border-gray-700 rounded-xl p-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-start gap-4">
                <div className="flex-grow min-w-0">
                  <h3 className="font-bold text-lg text-gray-800 dark:text-gray-100">
                    {request.username || 'Unknown User'}
                  </h3>
                  {request.message && (
                    <p className="mt-2 whitespace-pre-wrap text-gray-600 dark:text-gray-300">
                      {request.message}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-gray-400">
                    {request.createdAt?.toDate
                      ? request.createdAt.toDate().toLocaleString()
                      : 'Just now'}
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button
                    type="button"
                    onClick={() => decide(request, 'decline')}
                    disabled={processingId === request.id}
                    className="px-4 py-2 rounded-lg bg-gray-200 text-gray-700 font-semibold disabled:opacity-50"
                  >
                    Decline
                  </button>
                  <button
                    type="button"
                    onClick={() => decide(request, 'approve')}
                    disabled={processingId === request.id}
                    className="min-w-[92px] px-4 py-2 rounded-lg bg-green-600 text-white font-bold disabled:opacity-50"
                  >
                    {processingId === request.id ? <Spinner size="small" /> : 'Approve'}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
};

export default JoinRequestsManager;
