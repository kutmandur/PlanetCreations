"use strict";

const {randomUUID} = require("node:crypto");
const {getFirestore, Timestamp} = require("firebase-admin/firestore");
const {HttpsError} = require("firebase-functions/v2/https");

const OPERATION_GRACE_MS = 120000;

function deletionLockRef(db, uid) {
    return db.doc(`accountDeletionLocks/${uid}`);
}

async function isAccountActive(db, uid, transaction = null) {
    if (!uid) return false;
    const read = (ref) => transaction ? transaction.get(ref) : ref.get();
    const [user, lock] = await Promise.all([
        read(db.doc(`users/${uid}`)), read(deletionLockRef(db, uid)),
    ]);
    return user.exists && !lock.exists;
}

async function assertNotDeleting(db, uid) {
    if (uid && (await deletionLockRef(db, uid).get()).exists) {
        throw new HttpsError("failed-precondition", "Account deletion is in progress.");
    }
}

// Register before admitting a writer, in the same transaction that reads the
// deletion fence. The deletion worker drains admitted operations before taking
// its inventory. No request payload or credentials are stored in this journal.
async function withAccountOperation(uid, work, {
    db = getFirestore(), timeoutSeconds = 540, skipDeleted = false,
} = {}) {
    if (!uid) return work();
    const operation = db.collection("accountOperations").doc(randomUUID());
    const admitted = await db.runTransaction(async (tx) => {
        if ((await tx.get(deletionLockRef(db, uid))).exists) return false;
        if (skipDeleted && !(await tx.get(db.doc(`users/${uid}`))).exists) return false;
        tx.create(operation, {
            uid,
            expiresAt: Timestamp.fromMillis(Date.now() + timeoutSeconds * 1000 + OPERATION_GRACE_MS),
        });
        return true;
    });
    if (!admitted) {
        if (skipDeleted) return null;
        throw new HttpsError("failed-precondition", "Account deletion is in progress.");
    }
    try { return await work(); }
    finally {
        // An expired lease is recoverable by the deletion worker if cleanup
        // fails. Never turn a successfully committed operation into a retry.
        await operation.delete().catch(() => {});
    }
}

function eventAccountUid(event, snapshot) {
    if (!snapshot?.exists) return null;
    return event.params?.userId || snapshot.data()?.userId || null;
}

module.exports = {deletionLockRef, isAccountActive, assertNotDeleting, withAccountOperation, eventAccountUid};
