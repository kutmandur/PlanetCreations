import { doc, serverTimestamp, getDoc, writeBatch, collection, getDocs, query, where, arrayRemove, setDoc, deleteDoc, updateDoc } from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "./config";

/**
 * Allows a user to join a community, creating records in both the community's member list
 * and the user's public profile.
 * @param {string} communityId - The ID of the community to join.
 * @param {string} userId - The ID of the user joining.
 */
export const joinCommunity = async (communityId, userId) => {
    const batch = writeBatch(db);

    const profileRef = doc(db, 'profiles', userId);
    const communityRef = doc(db, 'communitys', communityId);
    const memberRef = doc(db, 'communitys', communityId, 'members', userId);
    const userMembershipRef = doc(db, 'profiles', userId, 'communityMemberships', communityId);

    const [profileSnap, communitySnap] = await Promise.all([
        getDoc(profileRef),
        getDoc(communityRef)
    ]);

    if (!profileSnap.exists() || !communitySnap.exists()) {
        throw new Error("User profile or community not found.");
    }

    const username = profileSnap.data().username || 'Unknown User';
    const communityData = communitySnap.data();
    const communityName = communityData.name;
    const defaultRank = communityData.defaultRankName || 'member';

    batch.set(memberRef, {
        roles: [defaultRank.toLowerCase()],
        username: username,
        joinedAt: serverTimestamp()
    });

    batch.set(userMembershipRef, {
        communityName: communityName,
        communityId: communityId,
        roles: [defaultRank.toLowerCase()],
        joinedAt: serverTimestamp()
    });

    await batch.commit();
};

export const requestCommunityJoin = async (communityId, user, message = '') => {
    if (!user?.uid) throw new Error('You must be signed in.');
    await setDoc(doc(db, 'communitys', communityId, 'joinRequests', user.uid), {
        userId: user.uid,
        username: user.username || 'Unknown User',
        message: String(message || '').trim(),
        status: 'pending',
        createdAt: serverTimestamp(),
    });
};

export const withdrawCommunityJoinRequest = async (communityId, userId) => {
    await deleteDoc(doc(db, 'communitys', communityId, 'joinRequests', userId));
};

export const decideCommunityJoinRequest = async (communityId, userId, decision) => {
    const callable = httpsCallable(getFunctions(), 'decideJoinRequest');
    return callable({ communityId, userId, decision });
};

export const removeCommunityCreation = async (communityId, creationId) => {
    const callable = httpsCallable(getFunctions(), 'removeCommunityCreation');
    return callable({ communityId, creationId });
};

export const setCommunityJoinPassword = async (communityId, password) => {
    const callable = httpsCallable(getFunctions(), 'setCommunityJoinPassword');
    return callable({ communityId, action: 'set', password });
};

export const clearCommunityJoinPassword = async (communityId) => {
    const callable = httpsCallable(getFunctions(), 'setCommunityJoinPassword');
    return callable({ communityId, action: 'clear' });
};

export const joinCommunityWithPassword = async (communityId, password) => {
    const callable = httpsCallable(getFunctions(), 'joinCommunityWithPassword');
    return callable({ communityId, password });
};

export const createCommunityInvite = async (communityId, targetUser, invitedBy) => {
    if (!targetUser?.id) throw new Error('Select a user to invite.');
    const profileSnap = await getDoc(doc(db, 'profiles', targetUser.id));
    if (!profileSnap.exists()) throw new Error('The selected user profile no longer exists.');
    const targetUsername = profileSnap.data().username;
    if (!targetUsername) throw new Error('The selected user does not have a valid username.');
    await setDoc(doc(db, 'communitys', communityId, 'invites', targetUser.id), {
        userId: targetUser.id,
        communityId,
        username: targetUsername,
        invitedBy,
        invitedAt: serverTimestamp(),
    });
};

export const acceptCommunityInvite = async (invite, userId) => {
    const communityId = invite.communityId;
    const [profileSnap, communitySnap, memberSnap] = await Promise.all([
        getDoc(doc(db, 'profiles', userId)),
        getDoc(doc(db, 'communitys', communityId)),
        getDoc(doc(db, 'communitys', communityId, 'members', userId)),
    ]);
    if (!profileSnap.exists() || !communitySnap.exists()) {
        throw new Error('User profile or community not found.');
    }
    if (memberSnap.exists()) {
        await deleteDoc(doc(db, 'communitys', communityId, 'invites', userId));
        return;
    }

    const communityData = communitySnap.data();
    const defaultRank = String(communityData.defaultRankName || 'member').toLowerCase();
    const roles = [defaultRank];
    const batch = writeBatch(db);
    batch.set(doc(db, 'communitys', communityId, 'members', userId), {
        roles,
        username: profileSnap.data().username || 'Unknown User',
        joinedAt: serverTimestamp(),
    });
    batch.set(doc(db, 'profiles', userId, 'communityMemberships', communityId), {
        communityId,
        communityName: communityData.name || 'Community',
        roles,
        joinedAt: serverTimestamp(),
    });
    batch.delete(doc(db, 'communitys', communityId, 'invites', userId));
    await batch.commit();
};

export const declineCommunityInvite = async (communityId, userId) => {
    await deleteDoc(doc(db, 'communitys', communityId, 'invites', userId));
};

/**
 * Allows a user to leave a community, deleting records from both the community's member list
 * and the user's public profile.
 * @param {string} communityId - The ID of the community to leave.
 * @param {string} userId - The ID of the user leaving.
 */
export const leaveCommunity = async (communityId, userId) => {
    const batch = writeBatch(db);

    const memberRef = doc(db, 'communitys', communityId, 'members', userId);
    const userMembershipRef = doc(db, 'profiles', userId, 'communityMemberships', communityId);

    batch.delete(memberRef);
    batch.delete(userMembershipRef);
    
    await batch.commit();
};

/**
 * [STAFF ONLY] Kicks a user from a community.
 * @param {string} communityId - The ID of the community.
 * @param {string} targetUserId - The ID of the user to kick.
 */
export const kickUser = async (communityId, targetUserId) => {
    // Community staff cannot write another user's profile mirror directly.
    // Deleting the authoritative member doc lets syncCommunityMembershipRoles
    // remove that mirror with the Admin SDK.
    await deleteDoc(doc(db, 'communitys', communityId, 'members', targetUserId));
};

/**
 * [STAFF ONLY] Kicks a user from a community and files a report against them.
 * @param {string} communityId - The ID of the community.
 * @param {string} targetUserId - The ID of the user to kick.
 * @param {string} reason - The reason for the report.
 * @param {string} staffUserId - The ID of the staff member filing the report.
 */
export const kickAndReportUser = async (communityId, targetUserId, reason, staffUserId) => {
    await kickUser(communityId, targetUserId);

    const batch = writeBatch(db);
    const reportRef = doc(collection(db, 'reports'));
    batch.set(reportRef, {
        targetId: targetUserId,
        targetType: 'user',
        reason: `Kicked from community. Reason: ${reason}`,
        reporterId: staffUserId,
        timestamp: serverTimestamp(),
    });
    // reportCount wird serverseitig vom onReportCreated-Trigger erhöht.
    await batch.commit();
};


/**
 * Allows a community owner or admin to assign new roles to a member.
 * @param {string} communityId - The ID of the community.
 * @param {string} targetUserId - The ID of the user whose roles are being changed.
 * @param {string[]} newRoles - The new array of roles to assign.
 */
export const assignCommunityRole = async (communityId, targetUserId, newRoles) => {
    const batch = writeBatch(db);
    const memberRef = doc(db, 'communitys', communityId, 'members', targetUserId);
    batch.update(memberRef, { roles: newRoles });
    await batch.commit();
};

/**
 * [OWNER ONLY] Transfers community ownership to another member. The previous owner
 * is demoted to the community's default rank. Atomic batch — the rules allow it
 * because they evaluate against the pre-batch state (current owner is still owner).
 */
export const transferCommunityOwnership = async (communityId, newOwnerId, oldOwnerId, defaultRankName = 'member') => {
    const batch = writeBatch(db);
    batch.update(doc(db, 'communitys', communityId), { ownerId: newOwnerId });
    batch.update(doc(db, 'communitys', communityId, 'members', newOwnerId), { roles: ['owner'] });
    batch.update(doc(db, 'communitys', communityId, 'members', oldOwnerId), {
        roles: [String(defaultRankName || 'member').toLowerCase()],
    });
    await batch.commit();
};

/**
 * [ADMIN ONLY] Deletes a community and all associated data.
 * @param {string} communityId The ID of the community to delete.
 */
export const deleteCommunityAsAdmin = async (communityId) => {
    const membersRef = collection(db, 'communitys', communityId, 'members');
    const membersSnapshot = await getDocs(membersRef);
    const memberIds = membersSnapshot.docs.map(d => d.id);

    const deleteBatch = writeBatch(db);

    const communityRef = doc(db, 'communitys', communityId);
    deleteBatch.delete(communityRef);

    memberIds.forEach(userId => {
        const memberDocRef = doc(db, 'communitys', communityId, 'members', userId);
        deleteBatch.delete(memberDocRef);

        const userMembershipRef = doc(db, 'profiles', userId, 'communityMemberships', communityId);
        deleteBatch.delete(userMembershipRef);
    });

    await deleteBatch.commit();

    const creationsQuery = query(collection(db, 'creations'), where('communityIds', 'array-contains', communityId));
    const creationsSnapshot = await getDocs(creationsQuery);

    if (!creationsSnapshot.empty) {
        const updateCreationsBatch = writeBatch(db);
        creationsSnapshot.forEach(creationDoc => {
            const creationRef = creationDoc.ref;
            const currentAssignments = creationDoc.data().communityAssignments || [];
            
            const newAssignments = currentAssignments.filter(assignment => assignment.communityId !== communityId);

            updateCreationsBatch.update(creationRef, {
                communityIds: arrayRemove(communityId),
                communityAssignments: newAssignments
            });
        });
        await updateCreationsBatch.commit();
    }
};

/**
 * [ADMIN ONLY] Adds or removes a community from the partner list.
 * Firestore rules enforce the admin custom claim independently of the UI.
 */
export const setCommunityPartnerStatus = async (communityId, isPartner) => {
    await updateDoc(doc(db, 'communitys', communityId), {
        isPartner: isPartner === true,
    });
};
