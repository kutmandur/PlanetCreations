import {
    doc,
    collection,
    query,
    where,
    getDocs,
    getDoc,
    addDoc,
    setDoc,
    updateDoc,
    deleteDoc,
    writeBatch,
    serverTimestamp,
    orderBy,
    arrayUnion,
    arrayRemove,
    increment
} from "firebase/firestore";
import { getFunctions, httpsCallable } from "firebase/functions";
import { db } from "./config";

const STORAGE_LIMIT = 500 * 1024 * 1024; // 500 MB
const MAX_VERSIONS_PER_USER_LIMITED = 1;

// ============================================
// COLLABORATION CRUD
// ============================================

/**
 * Creates a new collaboration.
 * @param {string} userId - The ID of the user creating the collaboration.
 * @param {object} data - The collaboration data.
 * @returns {string} The ID of the created collaboration.
 */
export const createCollaboration = async (userId, data) => {
    const { title, description, game } = data;

    // Get username first
    const profileSnap = await getDoc(doc(db, 'profiles', userId));
    const username = profileSnap.exists() ? profileSnap.data().username : 'Unknown';

    // Generate invite code
    const inviteCode = generateInviteCode();

    // Create collaboration document
    const collaborationRef = await addDoc(collection(db, 'collaborations'), {
        title,
        description,
        game, // 'planet-coaster-2' or 'planet-zoo'
        ownerId: userId,
        memberIds: [userId], // Array for querying user's collaborations
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        status: 'active', // 'active', 'completed', 'archived'
        inviteCode,
        storage: {
            totalBytes: 0,
            limitBytes: STORAGE_LIMIT,
            fileCount: 0
        }
    });

    // Add owner as first member using setDoc (not updateDoc)
    const memberRef = doc(db, 'collaborations', collaborationRef.id, 'members', userId);
    await setDoc(memberRef, {
        role: 'owner',
        joinedAt: serverTimestamp(),
        username
    });

    return collaborationRef.id;
};

/**
 * Fetches all collaborations for a user.
 * Uses collectionGroup query to find all memberships first, then fetches collaboration data.
 * @param {string} userId - The ID of the user.
 * @returns {Array} List of collaborations.
 */
export const fetchUserCollaborations = async (userId) => {
    const collaborations = [];

    // Query all member documents where the doc ID matches the userId
    // Since member doc IDs are the userId, we need a different approach
    // We'll store the userId in the member document and query by that

    // First, let's try to get collaborations where the user is the owner
    const ownerQuery = query(
        collection(db, 'collaborations'),
        where('ownerId', '==', userId)
    );
    const ownerSnapshot = await getDocs(ownerQuery);

    for (const docSnap of ownerSnapshot.docs) {
        const data = docSnap.data();
        if (data.status === 'active' || data.status === 'completed') {
            collaborations.push({
                id: docSnap.id,
                ...data,
                userRole: 'owner'
            });
        }
    }

    // For non-owned collaborations, we need to check member subcollections
    // This requires a collectionGroup index on 'members'
    // For now, we'll store collaboration IDs in user profile as a workaround

    // Alternative: Query by memberIds array on collaboration document
    const memberQuery = query(
        collection(db, 'collaborations'),
        where('memberIds', 'array-contains', userId)
    );

    try {
        const memberSnapshot = await getDocs(memberQuery);
        for (const docSnap of memberSnapshot.docs) {
            // Skip if already added as owner
            if (collaborations.some(c => c.id === docSnap.id)) continue;

            const data = docSnap.data();
            if (data.status === 'active' || data.status === 'completed') {
                // Get the user's role from members subcollection
                const memberRef = doc(db, 'collaborations', docSnap.id, 'members', userId);
                const memberSnap = await getDoc(memberRef);
                const role = memberSnap.exists() ? memberSnap.data().role : 'viewer';

                collaborations.push({
                    id: docSnap.id,
                    ...data,
                    userRole: role
                });
            }
        }
    } catch (error) {
        // memberIds field might not exist yet on older collaborations
        console.log('memberIds query not available:', error.message);
    }

    return collaborations;
};

/**
 * Fetches a single collaboration by ID.
 * @param {string} collaborationId - The collaboration ID.
 * @returns {object|null} The collaboration data or null.
 */
export const fetchCollaborationById = async (collaborationId) => {
    const docSnap = await getDoc(doc(db, 'collaborations', collaborationId));
    if (!docSnap.exists()) return null;
    return { id: docSnap.id, ...docSnap.data() };
};

/**
 * Updates collaboration settings.
 * @param {string} collaborationId - The collaboration ID.
 * @param {object} updates - The fields to update.
 */
export const updateCollaboration = async (collaborationId, updates) => {
    const collaborationRef = doc(db, 'collaborations', collaborationId);
    await updateDoc(collaborationRef, {
        ...updates,
        updatedAt: serverTimestamp()
    });
};

// ============================================
// MEMBER MANAGEMENT
// ============================================

/**
 * Join a collaboration via invite code.
 * @param {string} userId - The user joining.
 * @param {string} inviteCode - The invite code.
 * @returns {string} The collaboration ID.
 */
export const joinCollaborationByCode = async (userId, inviteCode) => {
    // Läuft serverseitig (Cloud Function), damit Clients nicht mehr alle
    // Collaborations inkl. Invite-Codes auflisten müssen/dürfen.
    const callable = httpsCallable(getFunctions(), 'joinCollaborationByInviteCode');
    const result = await callable({ inviteCode });
    return result.data.collaborationId;
};

/**
 * Leave a collaboration.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} userId - The user leaving.
 */
export const leaveCollaboration = async (collaborationId, userId) => {
    const collaborationSnap = await getDoc(doc(db, 'collaborations', collaborationId));
    if (!collaborationSnap.exists()) {
        throw new Error('Collaboration not found.');
    }

    if (collaborationSnap.data().ownerId === userId) {
        throw new Error('Owner cannot leave. Transfer ownership or delete the collaboration.');
    }

    // Remove member and update memberIds array
    const batch = writeBatch(db);
    batch.delete(doc(db, 'collaborations', collaborationId, 'members', userId));
    batch.update(doc(db, 'collaborations', collaborationId), {
        memberIds: arrayRemove(userId)
    });
    await batch.commit();
};

/**
 * Update a member's role.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} targetUserId - The user whose role to change.
 * @param {string} newRole - The new role ('editor' or 'viewer').
 */
export const updateMemberRole = async (collaborationId, targetUserId, newRole) => {
    if (!['editor', 'viewer'].includes(newRole)) {
        throw new Error('Invalid role. Must be "editor" or "viewer".');
    }

    const memberRef = doc(db, 'collaborations', collaborationId, 'members', targetUserId);
    await updateDoc(memberRef, { role: newRole });
};

/**
 * Remove a member from collaboration.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} targetUserId - The user to remove.
 */
export const removeMember = async (collaborationId, targetUserId) => {
    const batch = writeBatch(db);
    batch.delete(doc(db, 'collaborations', collaborationId, 'members', targetUserId));
    batch.update(doc(db, 'collaborations', collaborationId), {
        memberIds: arrayRemove(targetUserId)
    });
    await batch.commit();
};

/**
 * Delete a collaboration entirely.
 * Only the owner or site moderators/admins can do this.
 * @param {string} collaborationId - The collaboration ID.
 */
export const deleteCollaboration = async (collaborationId) => {
    const collaborationSnap = await getDoc(doc(db, 'collaborations', collaborationId));
    if (!collaborationSnap.exists()) {
        throw new Error('Collaboration not found.');
    }

    // Permission check is handled by Firestore rules
    // Rules allow: isCollaborationOwnerOrMod(collaborationId)

    // Delete all subcollections first
    const batch = writeBatch(db);

    // Delete members
    const membersSnap = await getDocs(collection(db, 'collaborations', collaborationId, 'members'));
    membersSnap.docs.forEach(doc => batch.delete(doc.ref));

    // Delete comments
    const commentsSnap = await getDocs(collection(db, 'collaborations', collaborationId, 'comments'));
    commentsSnap.docs.forEach(doc => batch.delete(doc.ref));

    // Delete files and their versions
    const filesSnap = await getDocs(collection(db, 'collaborations', collaborationId, 'files'));
    for (const fileDoc of filesSnap.docs) {
        const versionsSnap = await getDocs(collection(db, 'collaborations', collaborationId, 'files', fileDoc.id, 'versions'));
        versionsSnap.docs.forEach(vDoc => batch.delete(vDoc.ref));
        batch.delete(fileDoc.ref);
    }

    // Delete pending invitations
    const invitesSnap = await getDocs(collection(db, 'collaborations', collaborationId, 'invitations'));
    invitesSnap.docs.forEach(doc => batch.delete(doc.ref));

    // Delete the collaboration document
    batch.delete(doc(db, 'collaborations', collaborationId));

    await batch.commit();
};

/**
 * Fetch all members of a collaboration.
 * @param {string} collaborationId - The collaboration ID.
 * @returns {Array} List of members.
 */
export const fetchCollaborationMembers = async (collaborationId) => {
    const membersSnap = await getDocs(collection(db, 'collaborations', collaborationId, 'members'));
    return membersSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

/**
 * Generate a new invite code.
 * @param {string} collaborationId - The collaboration ID.
 * @returns {string} The new invite code.
 */
export const regenerateInviteCode = async (collaborationId) => {
    const newCode = generateInviteCode();
    await updateDoc(doc(db, 'collaborations', collaborationId), {
        inviteCode: newCode,
        updatedAt: serverTimestamp()
    });
    return newCode;
};

// ============================================
// INVITATION SYSTEM
// ============================================

/**
 * Send an invitation to a user.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} senderId - The user sending the invitation.
 * @param {string} targetUserId - The user to invite.
 * @param {string} role - The role to assign ('editor' or 'viewer').
 */
export const sendInvitation = async (collaborationId, senderId, targetUserId, role = 'editor') => {
    // Check if target is already a member
    const memberRef = doc(db, 'collaborations', collaborationId, 'members', targetUserId);
    const memberSnap = await getDoc(memberRef);
    if (memberSnap.exists()) {
        throw new Error('User is already a member of this collaboration.');
    }

    // Check if invitation already exists
    const existingInviteQuery = query(
        collection(db, 'collaborations', collaborationId, 'invitations'),
        where('targetUserId', '==', targetUserId),
        where('status', '==', 'pending')
    );
    const existingInviteSnap = await getDocs(existingInviteQuery);
    if (!existingInviteSnap.empty) {
        throw new Error('An invitation is already pending for this user.');
    }

    // Get sender and collaboration info
    const [senderProfile, collaborationSnap] = await Promise.all([
        getDoc(doc(db, 'profiles', senderId)),
        getDoc(doc(db, 'collaborations', collaborationId))
    ]);

    const senderUsername = senderProfile.exists() ? senderProfile.data().username : 'Unknown';
    const collaborationTitle = collaborationSnap.exists() ? collaborationSnap.data().title : 'Unknown';

    // Create invitation in collaboration subcollection
    const inviteRef = await addDoc(collection(db, 'collaborations', collaborationId, 'invitations'), {
        targetUserId,
        senderId,
        senderUsername,
        role,
        status: 'pending', // 'pending', 'accepted', 'declined'
        createdAt: serverTimestamp()
    });

    // Also create a notification/invite in the target user's invitations
    await addDoc(collection(db, 'users', targetUserId, 'collaborationInvites'), {
        collaborationId,
        collaborationTitle,
        inviteId: inviteRef.id,
        senderId,
        senderUsername,
        role,
        status: 'pending',
        createdAt: serverTimestamp()
    });

    return inviteRef.id;
};

/**
 * Accept an invitation.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} inviteId - The invitation ID.
 * @param {string} userId - The user accepting.
 */
export const acceptInvitation = async (collaborationId, inviteId, userId) => {
    const inviteRef = doc(db, 'collaborations', collaborationId, 'invitations', inviteId);
    const inviteSnap = await getDoc(inviteRef);

    if (!inviteSnap.exists()) {
        throw new Error('Invitation not found.');
    }

    const invite = inviteSnap.data();
    if (invite.targetUserId !== userId) {
        throw new Error('This invitation is not for you.');
    }

    if (invite.status !== 'pending') {
        throw new Error('This invitation has already been processed.');
    }

    // Get username
    const profileSnap = await getDoc(doc(db, 'profiles', userId));
    const username = profileSnap.exists() ? profileSnap.data().username : 'Unknown';

    // Add as member and update invitation status
    const batch = writeBatch(db);

    // Add member
    const memberRef = doc(db, 'collaborations', collaborationId, 'members', userId);
    batch.set(memberRef, {
        role: invite.role,
        joinedAt: serverTimestamp(),
        username
    });

    // Update memberIds
    batch.update(doc(db, 'collaborations', collaborationId), {
        memberIds: arrayUnion(userId)
    });

    // Update invitation status
    batch.update(inviteRef, {
        status: 'accepted',
        respondedAt: serverTimestamp()
    });

    // Update user's invite
    const userInvitesQuery = query(
        collection(db, 'users', userId, 'collaborationInvites'),
        where('inviteId', '==', inviteId)
    );
    const userInvitesSnap = await getDocs(userInvitesQuery);
    userInvitesSnap.docs.forEach(docSnap => {
        batch.update(docSnap.ref, {
            status: 'accepted',
            respondedAt: serverTimestamp()
        });
    });

    await batch.commit();
};

/**
 * Decline an invitation.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} inviteId - The invitation ID.
 * @param {string} userId - The user declining.
 */
export const declineInvitation = async (collaborationId, inviteId, userId) => {
    const inviteRef = doc(db, 'collaborations', collaborationId, 'invitations', inviteId);
    const inviteSnap = await getDoc(inviteRef);

    if (!inviteSnap.exists()) {
        throw new Error('Invitation not found.');
    }

    const invite = inviteSnap.data();
    if (invite.targetUserId !== userId) {
        throw new Error('This invitation is not for you.');
    }

    if (invite.status !== 'pending') {
        throw new Error('This invitation has already been processed.');
    }

    const batch = writeBatch(db);

    // Update invitation status
    batch.update(inviteRef, {
        status: 'declined',
        respondedAt: serverTimestamp()
    });

    // Update user's invite
    const userInvitesQuery = query(
        collection(db, 'users', userId, 'collaborationInvites'),
        where('inviteId', '==', inviteId)
    );
    const userInvitesSnap = await getDocs(userInvitesQuery);
    userInvitesSnap.docs.forEach(docSnap => {
        batch.update(docSnap.ref, {
            status: 'declined',
            respondedAt: serverTimestamp()
        });
    });

    await batch.commit();
};

/**
 * Get pending invitations for a user.
 * @param {string} userId - The user ID.
 * @returns {Array} List of pending invitations.
 */
export const fetchUserPendingInvitations = async (userId) => {
    const invitesQuery = query(
        collection(db, 'users', userId, 'collaborationInvites'),
        where('status', '==', 'pending'),
        orderBy('createdAt', 'desc')
    );

    const snapshot = await getDocs(invitesQuery);
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

/**
 * Get pending invitations for a collaboration (for owners to see).
 * @param {string} collaborationId - The collaboration ID.
 * @returns {Array} List of pending invitations.
 */
export const fetchCollaborationPendingInvitations = async (collaborationId) => {
    const invitesQuery = query(
        collection(db, 'collaborations', collaborationId, 'invitations'),
        where('status', '==', 'pending'),
        orderBy('createdAt', 'desc')
    );

    const snapshot = await getDocs(invitesQuery);

    // Get target user info
    const invites = [];
    for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const targetProfile = await getDoc(doc(db, 'profiles', data.targetUserId));
        invites.push({
            id: docSnap.id,
            ...data,
            targetUsername: targetProfile.exists() ? targetProfile.data().username : 'Unknown'
        });
    }

    return invites;
};

/**
 * Cancel a pending invitation (by owner/sender).
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} inviteId - The invitation ID.
 */
export const cancelInvitation = async (collaborationId, inviteId) => {
    const inviteRef = doc(db, 'collaborations', collaborationId, 'invitations', inviteId);
    const inviteSnap = await getDoc(inviteRef);

    if (!inviteSnap.exists()) {
        throw new Error('Invitation not found.');
    }

    const invite = inviteSnap.data();
    const batch = writeBatch(db);

    // Delete invitation
    batch.delete(inviteRef);

    // Delete from user's invites
    const userInvitesQuery = query(
        collection(db, 'users', invite.targetUserId, 'collaborationInvites'),
        where('inviteId', '==', inviteId)
    );
    const userInvitesSnap = await getDocs(userInvitesQuery);
    userInvitesSnap.docs.forEach(docSnap => batch.delete(docSnap.ref));

    await batch.commit();
};

/**
 * Search users by username for inviting.
 * @param {string} searchTerm - The search term.
 * @param {number} limit - Max results.
 * @returns {Array} List of matching users.
 */
export const searchUsersForInvite = async (searchTerm, limitCount = 10) => {
    if (!searchTerm || searchTerm.length < 2) {
        return [];
    }

    // Search by username prefix
    const searchLower = searchTerm.toLowerCase();
    const searchUpper = searchLower + '\uf8ff';

    const usersQuery = query(
        collection(db, 'profiles'),
        where('username_lowercase', '>=', searchLower),
        where('username_lowercase', '<=', searchUpper)
    );

    const snapshot = await getDocs(usersQuery);
    return snapshot.docs.slice(0, limitCount).map(doc => ({
        id: doc.id,
        username: doc.data().username,
        avatar: doc.data().profilePictureUrl
    }));
};

// ============================================
// FILE MANAGEMENT
// ============================================

/**
 * Add a new file to the collaboration.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} userId - The user uploading.
 * @param {object} fileData - The file metadata.
 * @returns {string} The file ID.
 */
export const addFile = async (collaborationId, userId, fileData) => {
    const { name, type, sizeBytes, storageUrl, note } = fileData;

    // Get username
    const profileSnap = await getDoc(doc(db, 'profiles', userId));
    const username = profileSnap.exists() ? profileSnap.data().username : 'Unknown';

    const fileRef = await addDoc(collection(db, 'collaborations', collaborationId, 'files'), {
        name,
        type,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        currentVersion: {
            number: 1,
            uploadedBy: userId,
            uploadedByUsername: username,
            uploadedAt: serverTimestamp(),
            sizeBytes,
            storageUrl,
            note: note || ''
        },
        lock: null,
        waitingUsers: []
    });

    // Add first version to user's version history
    await addDoc(collection(db, 'collaborations', collaborationId, 'files', fileRef.id, 'versions'), {
        versionNumber: 1,
        uploadedBy: userId,
        uploadedByUsername: username,
        uploadedAt: serverTimestamp(),
        sizeBytes,
        storageUrl,
        note: note || '',
        isCurrentVersion: true
    });

    // Update storage stats
    await updateDoc(doc(db, 'collaborations', collaborationId), {
        'storage.totalBytes': increment(sizeBytes),
        'storage.fileCount': increment(1),
        updatedAt: serverTimestamp()
    });

    // Run storage cleanup
    await cleanupStorageIfNeeded(collaborationId);

    return fileRef.id;
};

/**
 * Upload a new version of a file.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} fileId - The file ID.
 * @param {string} userId - The user uploading.
 * @param {object} versionData - The version metadata.
 */
export const uploadNewVersion = async (collaborationId, fileId, userId, versionData) => {
    const { sizeBytes, storageUrl, note } = versionData;

    const fileRef = doc(db, 'collaborations', collaborationId, 'files', fileId);
    const fileSnap = await getDoc(fileRef);

    if (!fileSnap.exists()) {
        throw new Error('File not found.');
    }

    const fileData = fileSnap.data();
    const newVersionNumber = fileData.currentVersion.number + 1;

    // Get username
    const profileSnap = await getDoc(doc(db, 'profiles', userId));
    const username = profileSnap.exists() ? profileSnap.data().username : 'Unknown';

    const batch = writeBatch(db);

    // Mark old current version as not current
    const oldVersionsQuery = query(
        collection(db, 'collaborations', collaborationId, 'files', fileId, 'versions'),
        where('isCurrentVersion', '==', true)
    );
    const oldVersionsSnap = await getDocs(oldVersionsQuery);
    oldVersionsSnap.docs.forEach(doc => {
        batch.update(doc.ref, { isCurrentVersion: false });
    });

    // Add new version
    const newVersionRef = doc(collection(db, 'collaborations', collaborationId, 'files', fileId, 'versions'));
    batch.set(newVersionRef, {
        versionNumber: newVersionNumber,
        uploadedBy: userId,
        uploadedByUsername: username,
        uploadedAt: serverTimestamp(),
        sizeBytes,
        storageUrl,
        note: note || '',
        isCurrentVersion: true
    });

    // Update file's current version
    batch.update(fileRef, {
        currentVersion: {
            number: newVersionNumber,
            uploadedBy: userId,
            uploadedByUsername: username,
            uploadedAt: serverTimestamp(),
            sizeBytes,
            storageUrl,
            note: note || ''
        },
        updatedAt: serverTimestamp(),
        lock: null, // Release lock on upload
        waitingUsers: [] // Clear waiting list
    });

    // Update storage stats
    const collaborationRef = doc(db, 'collaborations', collaborationId);
    batch.update(collaborationRef, {
        'storage.totalBytes': increment(sizeBytes),
        updatedAt: serverTimestamp()
    });

    await batch.commit();

    // Notify waiting users
    if (fileData.waitingUsers && fileData.waitingUsers.length > 0) {
        await notifyWaitingUsers(collaborationId, fileId, fileData.name, userId, username);
    }

    // Run storage cleanup
    await cleanupStorageIfNeeded(collaborationId);
};

/**
 * Fetch all files of a collaboration.
 * @param {string} collaborationId - The collaboration ID.
 * @returns {Array} List of files.
 */
export const fetchCollaborationFiles = async (collaborationId) => {
    const filesSnap = await getDocs(
        query(collection(db, 'collaborations', collaborationId, 'files'), orderBy('updatedAt', 'desc'))
    );
    return filesSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

/**
 * Fetch version history for a file.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} fileId - The file ID.
 * @returns {Array} List of versions grouped by user.
 */
export const fetchFileVersions = async (collaborationId, fileId) => {
    const versionsSnap = await getDocs(
        query(
            collection(db, 'collaborations', collaborationId, 'files', fileId, 'versions'),
            orderBy('uploadedAt', 'desc')
        )
    );

    const versions = versionsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    // Group by user
    const byUser = {};
    versions.forEach(version => {
        if (!byUser[version.uploadedBy]) {
            byUser[version.uploadedBy] = {
                userId: version.uploadedBy,
                username: version.uploadedByUsername,
                versions: []
            };
        }
        byUser[version.uploadedBy].versions.push(version);
    });

    return {
        all: versions,
        byUser: Object.values(byUser)
    };
};

/**
 * Restore a previous version as the current version.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} fileId - The file ID.
 * @param {string} versionId - The version to restore.
 * @param {string} userId - The user performing the restore.
 * @param {string} reason - Reason for restoration.
 */
export const restoreVersion = async (collaborationId, fileId, versionId, userId, reason) => {
    const versionRef = doc(db, 'collaborations', collaborationId, 'files', fileId, 'versions', versionId);
    const versionSnap = await getDoc(versionRef);

    if (!versionSnap.exists()) {
        throw new Error('Version not found.');
    }

    const versionData = versionSnap.data();

    // Upload as new version (this handles all the logic)
    await uploadNewVersion(collaborationId, fileId, userId, {
        sizeBytes: versionData.sizeBytes,
        storageUrl: versionData.storageUrl,
        note: `Restored from v${versionData.versionNumber}. Reason: ${reason}`
    });
};

// ============================================
// LOCK SYSTEM (Soft Lock)
// ============================================

/**
 * Check out a file (mark as being edited).
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} fileId - The file ID.
 * @param {string} userId - The user checking out.
 * @param {string} note - Optional note about what they're working on.
 * @param {number} expectedMinutes - Estimated editing time.
 */
export const checkOutFile = async (collaborationId, fileId, userId, note = '', expectedMinutes = 60) => {
    const profileSnap = await getDoc(doc(db, 'profiles', userId));
    const username = profileSnap.exists() ? profileSnap.data().username : 'Unknown';

    const fileRef = doc(db, 'collaborations', collaborationId, 'files', fileId);
    await updateDoc(fileRef, {
        lock: {
            lockedBy: userId,
            lockedByUsername: username,
            lockedAt: serverTimestamp(),
            note,
            expectedMinutes
        },
        updatedAt: serverTimestamp()
    });
};

/**
 * Check in a file (release lock without uploading).
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} fileId - The file ID.
 * @param {string} userId - The user checking in.
 */
export const checkInFile = async (collaborationId, fileId, userId) => {
    const fileRef = doc(db, 'collaborations', collaborationId, 'files', fileId);
    const fileSnap = await getDoc(fileRef);

    if (!fileSnap.exists()) {
        throw new Error('File not found.');
    }

    const fileData = fileSnap.data();

    // Only the user who locked it or an owner can unlock
    if (fileData.lock && fileData.lock.lockedBy !== userId) {
        throw new Error('Only the user who locked the file can release it.');
    }

    await updateDoc(fileRef, {
        lock: null,
        updatedAt: serverTimestamp()
    });

    // Notify waiting users
    if (fileData.waitingUsers && fileData.waitingUsers.length > 0) {
        const profileSnap = await getDoc(doc(db, 'profiles', userId));
        const username = profileSnap.exists() ? profileSnap.data().username : 'Unknown';
        await notifyWaitingUsers(collaborationId, fileId, fileData.name, userId, username);
    }
};

/**
 * Force unlock a file (owner/admin only).
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} fileId - The file ID.
 */
export const forceUnlockFile = async (collaborationId, fileId) => {
    const fileRef = doc(db, 'collaborations', collaborationId, 'files', fileId);
    await updateDoc(fileRef, {
        lock: null,
        updatedAt: serverTimestamp()
    });
};

/**
 * Subscribe to be notified when file is released.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} fileId - The file ID.
 * @param {string} userId - The user subscribing.
 */
export const subscribeToFileRelease = async (collaborationId, fileId, userId) => {
    const fileRef = doc(db, 'collaborations', collaborationId, 'files', fileId);
    await updateDoc(fileRef, {
        waitingUsers: arrayUnion(userId)
    });
};

/**
 * Unsubscribe from file release notifications.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} fileId - The file ID.
 * @param {string} userId - The user unsubscribing.
 */
export const unsubscribeFromFileRelease = async (collaborationId, fileId, userId) => {
    const fileRef = doc(db, 'collaborations', collaborationId, 'files', fileId);
    await updateDoc(fileRef, {
        waitingUsers: arrayRemove(userId)
    });
};

// ============================================
// COMMENTS
// ============================================

/**
 * Add a comment to the collaboration.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} userId - The user commenting.
 * @param {object} commentData - The comment data.
 * @returns {string} The comment ID.
 */
export const addComment = async (collaborationId, userId, commentData) => {
    const { content, fileId = null, parentId = null } = commentData;

    const profileSnap = await getDoc(doc(db, 'profiles', userId));
    const username = profileSnap.exists() ? profileSnap.data().username : 'Unknown';
    const avatarUrl = profileSnap.exists() ? profileSnap.data().avatarUrl : null;

    const commentRef = await addDoc(collection(db, 'collaborations', collaborationId, 'comments'), {
        authorId: userId,
        authorUsername: username,
        authorAvatarUrl: avatarUrl,
        content,
        fileId,
        parentId,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
    });

    // Update collaboration's updatedAt
    await updateDoc(doc(db, 'collaborations', collaborationId), {
        updatedAt: serverTimestamp()
    });

    return commentRef.id;
};

/**
 * Fetch comments for a collaboration.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string|null} fileId - Optional file ID to filter by.
 * @returns {Array} List of comments.
 */
export const fetchComments = async (collaborationId, fileId = null) => {
    let commentsQuery;

    if (fileId) {
        commentsQuery = query(
            collection(db, 'collaborations', collaborationId, 'comments'),
            where('fileId', '==', fileId),
            orderBy('createdAt', 'asc')
        );
    } else {
        commentsQuery = query(
            collection(db, 'collaborations', collaborationId, 'comments'),
            orderBy('createdAt', 'asc')
        );
    }

    const commentsSnap = await getDocs(commentsQuery);
    return commentsSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
};

/**
 * Delete a comment.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} commentId - The comment ID.
 */
export const deleteComment = async (collaborationId, commentId) => {
    await deleteDoc(doc(db, 'collaborations', collaborationId, 'comments', commentId));
};

// ============================================
// STORAGE MANAGEMENT
// ============================================

/**
 * Clean up storage if over limit.
 * @param {string} collaborationId - The collaboration ID.
 */
export const cleanupStorageIfNeeded = async (collaborationId) => {
    const collaborationRef = doc(db, 'collaborations', collaborationId);
    const collaborationSnap = await getDoc(collaborationRef);

    if (!collaborationSnap.exists()) return;

    const storage = collaborationSnap.data().storage || { totalBytes: 0, limitBytes: STORAGE_LIMIT };

    if (storage.totalBytes < STORAGE_LIMIT) return;

    // Get all files
    const filesSnap = await getDocs(collection(db, 'collaborations', collaborationId, 'files'));

    let totalDeleted = 0;

    // Step 1: Reduce each user to 1 version per file
    for (const fileDoc of filesSnap.docs) {
        const versionsSnap = await getDocs(
            query(
                collection(db, 'collaborations', collaborationId, 'files', fileDoc.id, 'versions'),
                orderBy('uploadedAt', 'desc')
            )
        );

        // Group by user
        const byUser = {};
        versionsSnap.docs.forEach(doc => {
            const data = doc.data();
            if (!byUser[data.uploadedBy]) {
                byUser[data.uploadedBy] = [];
            }
            byUser[data.uploadedBy].push({ id: doc.id, ref: doc.ref, ...data });
        });

        // Delete extra versions (keep only newest per user)
        for (const userId in byUser) {
            const userVersions = byUser[userId];
            if (userVersions.length > MAX_VERSIONS_PER_USER_LIMITED) {
                const toDelete = userVersions.slice(MAX_VERSIONS_PER_USER_LIMITED);
                for (const version of toDelete) {
                    if (!version.isCurrentVersion) {
                        await deleteDoc(version.ref);
                        totalDeleted += version.sizeBytes || 0;
                    }
                }
            }
        }

        // Check if we're under limit
        if (storage.totalBytes - totalDeleted < STORAGE_LIMIT) break;
    }

    // Step 2: If still over limit, delete oldest non-current versions globally
    if (storage.totalBytes - totalDeleted >= STORAGE_LIMIT) {
        for (const fileDoc of filesSnap.docs) {
            const versionsSnap = await getDocs(
                query(
                    collection(db, 'collaborations', collaborationId, 'files', fileDoc.id, 'versions'),
                    where('isCurrentVersion', '==', false),
                    orderBy('uploadedAt', 'asc')
                )
            );

            for (const versionDoc of versionsSnap.docs) {
                const versionData = versionDoc.data();
                await deleteDoc(versionDoc.ref);
                totalDeleted += versionData.sizeBytes || 0;

                // TODO: Delete from S3 storage as well
                // await deleteFromS3(versionData.storageUrl);

                if (storage.totalBytes - totalDeleted < STORAGE_LIMIT) break;
            }

            if (storage.totalBytes - totalDeleted < STORAGE_LIMIT) break;
        }
    }

    // Update storage stats
    if (totalDeleted > 0) {
        await updateDoc(collaborationRef, {
            'storage.totalBytes': increment(-totalDeleted),
            'storage.lastCleanup': serverTimestamp()
        });
    }
};

/**
 * Calculate current storage usage.
 * @param {string} collaborationId - The collaboration ID.
 * @returns {object} Storage stats.
 */
export const calculateStorageUsage = async (collaborationId) => {
    const filesSnap = await getDocs(collection(db, 'collaborations', collaborationId, 'files'));

    let totalBytes = 0;
    let versionCount = 0;

    for (const fileDoc of filesSnap.docs) {
        const versionsSnap = await getDocs(
            collection(db, 'collaborations', collaborationId, 'files', fileDoc.id, 'versions')
        );

        for (const versionDoc of versionsSnap.docs) {
            totalBytes += versionDoc.data().sizeBytes || 0;
            versionCount++;
        }
    }

    return {
        totalBytes,
        limitBytes: STORAGE_LIMIT,
        usagePercent: Math.round((totalBytes / STORAGE_LIMIT) * 100),
        fileCount: filesSnap.size,
        versionCount
    };
};

// ============================================
// NOTIFICATIONS
// ============================================

/**
 * Notify users that a file has been released.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} fileId - The file ID.
 * @param {string} fileName - The file name.
 * @param {string} releasedBy - User ID who released it.
 * @param {string} releasedByUsername - Username who released it.
 */
const notifyWaitingUsers = async (collaborationId, fileId, fileName, releasedBy, releasedByUsername) => {
    const fileRef = doc(db, 'collaborations', collaborationId, 'files', fileId);
    const fileSnap = await getDoc(fileRef);

    if (!fileSnap.exists()) return;

    // Collaboration "file available" notifications need a server-side fan-out
    // (a client cannot write to other users' inbox doc). Deferred until the
    // Collaboration feature ships; for now just clear the waiting list.
    const batch = writeBatch(db);
    batch.update(fileRef, { waitingUsers: [] });
    await batch.commit();
};

// ============================================
// HELPERS
// ============================================

/**
 * Generate a random invite code.
 * @returns {string} A random 8-character code.
 */
const generateInviteCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 8; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
};

// ============================================
// TODO ITEMS
// ============================================

/**
 * Add a todo item to a collaboration.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} userId - The user adding the todo.
 * @param {string} text - The todo text.
 */
export const addTodo = async (collaborationId, userId, text) => {
    const profileSnap = await getDoc(doc(db, 'profiles', userId));
    const username = profileSnap.exists() ? profileSnap.data().username : 'Unknown';

    await addDoc(collection(db, 'collaborations', collaborationId, 'todos'), {
        text,
        completed: false,
        createdBy: userId,
        createdByUsername: username,
        createdAt: serverTimestamp(),
        completedAt: null,
        completedBy: null,
        completedByUsername: null
    });
};

/**
 * Toggle a todo item's completion status.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} todoId - The todo ID.
 * @param {string} userId - The user toggling.
 * @param {boolean} completed - New completion status.
 */
export const toggleTodo = async (collaborationId, todoId, userId, completed) => {
    const todoRef = doc(db, 'collaborations', collaborationId, 'todos', todoId);

    if (completed) {
        const profileSnap = await getDoc(doc(db, 'profiles', userId));
        const username = profileSnap.exists() ? profileSnap.data().username : 'Unknown';

        await updateDoc(todoRef, {
            completed: true,
            completedAt: serverTimestamp(),
            completedBy: userId,
            completedByUsername: username
        });
    } else {
        await updateDoc(todoRef, {
            completed: false,
            completedAt: null,
            completedBy: null,
            completedByUsername: null
        });
    }
};

/**
 * Delete a todo item.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} todoId - The todo ID.
 */
export const deleteTodo = async (collaborationId, todoId) => {
    await deleteDoc(doc(db, 'collaborations', collaborationId, 'todos', todoId));
};

// ============================================
// WORK SESSIONS (Build History)
// ============================================

/**
 * Start a work session (when checking out a file).
 * Called automatically by checkOutFile.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} fileId - The file ID.
 * @param {string} userId - The user starting work.
 * @param {string} note - Optional note about what they're working on.
 */
export const startWorkSession = async (collaborationId, fileId, userId, note = '') => {
    const profileSnap = await getDoc(doc(db, 'profiles', userId));
    const username = profileSnap.exists() ? profileSnap.data().username : 'Unknown';

    const fileSnap = await getDoc(doc(db, 'collaborations', collaborationId, 'files', fileId));
    const fileName = fileSnap.exists() ? fileSnap.data().name : 'Unknown File';

    await addDoc(collection(db, 'collaborations', collaborationId, 'workSessions'), {
        fileId,
        fileName,
        userId,
        username,
        note,
        startedAt: serverTimestamp(),
        endedAt: null,
        durationMinutes: null
    });
};

/**
 * End a work session (when checking in a file).
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} fileId - The file ID.
 * @param {string} userId - The user ending work.
 */
export const endWorkSession = async (collaborationId, fileId, userId) => {
    // Find the active session
    const sessionsQuery = query(
        collection(db, 'collaborations', collaborationId, 'workSessions'),
        where('fileId', '==', fileId),
        where('userId', '==', userId),
        where('endedAt', '==', null)
    );

    const sessionsSnap = await getDocs(sessionsQuery);

    if (!sessionsSnap.empty) {
        const sessionDoc = sessionsSnap.docs[0];
        const sessionData = sessionDoc.data();
        const startTime = sessionData.startedAt?.toDate?.() || new Date();
        const endTime = new Date();
        const durationMinutes = Math.round((endTime - startTime) / 60000);

        await updateDoc(sessionDoc.ref, {
            endedAt: serverTimestamp(),
            durationMinutes
        });
    }
};

/**
 * Add an upload/changelog entry.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} fileId - The file ID.
 * @param {string} userId - The uploader.
 * @param {object} data - Upload data (changelog, version info, etc.)
 */
export const addUploadEntry = async (collaborationId, fileId, userId, data) => {
    const profileSnap = await getDoc(doc(db, 'profiles', userId));
    const username = profileSnap.exists() ? profileSnap.data().username : 'Unknown';

    const fileSnap = await getDoc(doc(db, 'collaborations', collaborationId, 'files', fileId));
    const fileName = fileSnap.exists() ? fileSnap.data().name : 'Unknown File';

    await addDoc(collection(db, 'collaborations', collaborationId, 'uploads'), {
        fileId,
        fileName,
        userId,
        username,
        changelog: data.changelog || '',
        workDurationMinutes: data.workDurationMinutes || 0,
        versionNumber: data.versionNumber || 1,
        sizeBytes: data.sizeBytes || 0,
        createdAt: serverTimestamp()
    });
};
