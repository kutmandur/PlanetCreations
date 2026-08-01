import {
    doc,
    collection,
    query,
    where,
    getDocs,
    getDoc,
    addDoc,
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
import { searchUsers } from "./userIndexService";

const STORAGE_LIMIT = 500 * 1024 * 1024; // 500 MB
const MAX_VERSIONS_PER_USER_LIMITED = 1;
const COLLABORATION_OVERVIEW_STATUSES = new Set([
    'active',
    'completed',
    'published',
    'archived',
]);

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
    // Serverseitig anlegen (Cloud Function): das Admin-SDK umgeht die Rules, sodass
    // die Firestore-Regel Client-Create verbieten kann und ownerId/memberIds nicht
    // fälschbar sind. `userId` bleibt für die Signatur erhalten (kommt server aus dem Auth-Context).
    const callable = httpsCallable(getFunctions(), 'createCollaboration');
    const result = await callable({
        title: data.title,
        description: data.description,
        game: data.game,
        visibility: data.visibility,
        joinMode: data.joinMode,
        password: data.password,
        bannerImageUrl: data.bannerImageUrl,
        galleryImageUrls: data.galleryImageUrls,
        initialUploadId: data.initialUploadId,
        initialNote: data.initialNote,
    });
    return result.data;
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
        if (COLLABORATION_OVERVIEW_STATUSES.has(data.status || 'active')) {
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
            if (COLLABORATION_OVERVIEW_STATUSES.has(data.status || 'active')) {
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

/** Safe public directory entries. Invite credentials never leave the callable. */
export const fetchPublicCollaborations = async () => {
    const callable = httpsCallable(getFunctions(), 'listPublicCollaborations');
    const result = await callable();
    return result.data.collaborations || [];
};

/** Read-only public detail projection without invite credentials or R2 keys. */
export const fetchPublicCollaborationView = async (collaborationId) => {
    const callable = httpsCallable(getFunctions(), 'getPublicCollaborationView');
    const result = await callable({ collaborationId });
    return result.data;
};

/**
 * One on-demand overlay read for collaborations belonging to the running game.
 * Roles and members stay server-validated when an action is attempted, avoiding
 * a member-subcollection read per collaboration.
 */
export const fetchUserCollaborationsForGame = async (userId, gameId) => {
    if (!userId || !gameId) return [];
    const snapshot = await getDocs(query(
        collection(db, 'collaborations'),
        where('memberIds', 'array-contains', userId),
        where('game', '==', gameId),
    ));
    return snapshot.docs
        .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
        .filter((collaboration) => collaboration.status === 'active');
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
 * Read-only join info for an invite code (so the join page can render the right UI
 * per joinMode). Also returns safe presentation fields for the join card.
 */
export const getCollaborationJoinInfo = async (inviteCode) => {
    const callable = httpsCallable(getFunctions(), 'getCollaborationJoinInfo');
    const result = await callable({ inviteCode });
    return result.data;
};

/** Join a password-gated collaboration. */
export const joinCollaborationByPassword = async (inviteCode, password) => {
    const callable = httpsCallable(getFunctions(), 'joinCollaborationByPassword');
    const result = await callable({ inviteCode, password });
    return result.data.collaborationId;
};

/** Apply to an application-gated collaboration (owner approves later). */
export const applyToCollaboration = async (inviteCode, message = '') => {
    const callable = httpsCallable(getFunctions(), 'applyToCollaboration');
    const result = await callable({ inviteCode, message });
    return result.data;
};

/** Owner: approve/decline a pending application. */
export const respondToApplication = async (collaborationId, applicantId, approve) => {
    const callable = httpsCallable(getFunctions(), 'respondToCollaborationApplication');
    await callable({ collaborationId, applicantId, approve });
};

/** Fetch pending applications for a collaboration (owner/member on-demand read). */
export const fetchCollaborationApplications = async (collaborationId) => {
    const snap = await getDocs(query(
        collection(db, 'collaborations', collaborationId, 'applications'),
        where('status', '==', 'pending')
    ));
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
};

/** Owner: update collaboration settings, appearance and access. Server-side & hashed. */
export const updateCollaborationSettings = async (collaborationId, settings) => {
    const callable = httpsCallable(getFunctions(), 'updateCollaborationSettings');
    await callable({ collaborationId, ...settings });
};

/** Start a build session (advisory turn-lock; estimateMin sizes the fallback expiry). */
export const startBuildSession = async (
    collaborationId,
    estimateMin = 60,
    acknowledgeMissingSave = false,
) => {
    const callable = httpsCallable(getFunctions(), 'startBuildSession');
    const result = await callable({
        collaborationId,
        estimateMin,
        acknowledgeMissingSave,
    });
    return result.data;
};

/** End the current build session (manual log-off / auto on game close / owner force-release). */
export const endBuildSession = async (
    collaborationId,
    force = false,
    endedAtMillis = null,
    buildDraft = null,
    buildSessionId = null,
) => {
    const callable = httpsCallable(getFunctions(), 'endBuildSession');
    const result = await callable({
        collaborationId,
        force,
        endedAtMillis,
        buildDraft,
        buildSessionId,
    });
    return result.data;
};

/** Finalize an uploaded (signed) save as a new collaboration version. */
export const finalizeCollaborationVersion = async (
    uploadId,
    collaborationId,
    changelogEntryId,
    note = '',
    imageUrls = [],
    completedTodos = [],
) => {
    const callable = httpsCallable(getFunctions(), 'finalizeCollaborationVersion');
    const result = await callable({
        uploadId,
        collaborationId,
        changelogEntryId,
        note,
        imageUrls,
        completedTodos,
    });
    return result.data;
};

/** Edit the author's changelog content without changing its server-managed save link. */
export const updateCollaborationChangelogEntry = async (
    collaborationId,
    changelogEntryId,
    text = '',
    imageUrls = [],
    completedTodos = [],
) => {
    const callable = httpsCallable(
        getFunctions(),
        'updateCollaborationChangelogEntry',
    );
    const result = await callable({
        collaborationId,
        changelogEntryId,
        text,
        imageUrls,
        completedTodos,
    });
    return result.data;
};

/** Get a short-lived signed download URL for a collaboration version (members only). */
export const getCollaborationVersionDownloadUrl = async (collaborationId, versionId) => {
    const callable = httpsCallable(getFunctions(), 'getCollaborationVersionDownloadUrl');
    const result = await callable({ collaborationId, versionId });
    return result.data;
};

/**
 * Leave a collaboration.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} userId - The user leaving.
 */
export const leaveCollaboration = async (collaborationId) => {
    const callable = httpsCallable(getFunctions(), 'leaveCollaboration');
    await callable({ collaborationId });
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

    const callable = httpsCallable(getFunctions(), 'updateCollaborationMemberRole');
    await callable({ collaborationId, targetUserId, role: newRole });
};

/**
 * Remove a member from collaboration.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} targetUserId - The user to remove.
 */
export const removeMember = async (collaborationId, targetUserId) => {
    const callable = httpsCallable(getFunctions(), 'removeCollaborationMember');
    await callable({ collaborationId, targetUserId });
};

/**
 * Delete a collaboration entirely.
 * Only the owner or site moderators/admins can do this.
 * @param {string} collaborationId - The collaboration ID.
 */
export const deleteCollaboration = async (collaborationId) => {
    const callable = httpsCallable(getFunctions(), 'deleteCollaboration');
    const result = await callable({ collaborationId });
    return result.data;
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
    const callable = httpsCallable(
        getFunctions(),
        'regenerateCollaborationInviteCode',
    );
    const result = await callable({ collaborationId });
    return result.data.inviteCode;
};

// ============================================
// INVITATION SYSTEM
// ============================================

/**
 * Send an invitation to a user.
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} targetUserId - The user to invite.
 * @param {string} role - The role to assign ('editor' or 'viewer').
 */
export const sendInvitation = async (collaborationId, targetUserId, role = 'editor') => {
    const callable = httpsCallable(getFunctions(), 'sendCollaborationInvitation');
    const result = await callable({ collaborationId, targetUserId, role });
    return result.data.invitation;
};

/**
 * Accept an invitation.
 * @param {string} collaborationId - The collaboration ID.
 */
export const acceptInvitation = async (collaborationId) => {
    const callable = httpsCallable(
        getFunctions(),
        'respondToCollaborationInvitation',
    );
    await callable({ collaborationId, accept: true });
};

/**
 * Decline an invitation.
 * @param {string} collaborationId - The collaboration ID.
 */
export const declineInvitation = async (collaborationId) => {
    const callable = httpsCallable(
        getFunctions(),
        'respondToCollaborationInvitation',
    );
    await callable({ collaborationId, accept: false });
};

/**
 * Get pending invitations for a user.
 * @param {string} userId - The user ID.
 * @returns {Array} List of pending invitations.
 */
export const fetchUserPendingInvitations = async (userId) => {
    if (!userId) return [];
    const callable = httpsCallable(
        getFunctions(),
        'listMyCollaborationInvitations',
    );
    const result = await callable();
    return result.data.invitations || [];
};

/**
 * Get pending invitations for a collaboration (for owners to see).
 * @param {string} collaborationId - The collaboration ID.
 * @returns {Array} List of pending invitations.
 */
export const fetchCollaborationPendingInvitations = async (collaborationId) => {
    const callable = httpsCallable(
        getFunctions(),
        'listCollaborationInvitations',
    );
    const result = await callable({ collaborationId });
    return result.data.invitations || [];
};

/**
 * Cancel a pending invitation (by owner/site staff).
 * @param {string} collaborationId - The collaboration ID.
 * @param {string} targetUserId - The invited user ID.
 */
export const cancelInvitation = async (collaborationId, targetUserId) => {
    const callable = httpsCallable(
        getFunctions(),
        'cancelCollaborationInvitation',
    );
    await callable({ collaborationId, targetUserId });
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

    return searchUsers(searchTerm, limitCount);
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

    const versions = versionsSnap.docs.map((versionDoc) => {
        const data = versionDoc.data();
        return {
            id: versionDoc.id,
            ...data,
            versionNumber: data.versionNumber || data.number || 1,
        };
    });

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
