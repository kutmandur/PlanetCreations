import { doc, serverTimestamp, getDoc, writeBatch, collection, getDocs, query, where, arrayRemove } from "firebase/firestore";
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
    await leaveCommunity(communityId, targetUserId); // The logic is identical to leaving
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
