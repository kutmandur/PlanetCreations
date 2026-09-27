"use strict";
const {randomBytes, createHash, randomUUID} = require("node:crypto");
const {Timestamp, FieldPath} = require("firebase-admin/firestore");
const {HttpsError} = require("firebase-functions/v2/https");
const {deleteCommunityData} = require("./communityDeletion");
const {removeAccountFromCollaboration} = require("./collaborationDeletion");

const hash = value => createHash("sha256").update(value).digest("hex");
const PAGE_SIZE = 25;
const PHASES = ["drain", "collaborations", "communities", "creations", "references", "storage", "identity", "auth"];

async function anonymizeBallots(db, uid) {
    const ballots = await db.collectionGroup("ballots").where("userId", "==", uid).get();
    for (const ballot of ballots.docs) await db.runTransaction(async tx => {
        const current = await tx.get(ballot.ref);
        const event = await tx.get(ballot.ref.parent.parent);
        if (!current.exists) return;
        if (event.exists) tx.create(event.ref.collection("anonymousBallots").doc(), {
            creationIds: current.data().creationIds || [],
        });
        tx.delete(ballot.ref);
    });
}

function createAccountDeletionService({db, auth, services, now = Date.now, graceMs = 22 * 60 * 1000}) {
    const jobs = db.collection("accountDeletionJobs");
    async function preview(uid) {
        const communities = await db.collection("communitys").where("ownerId", "==", uid).get();
        return {communities: communities.docs.map(doc => ({id: doc.id, name: doc.data().name || doc.data().title || doc.id}))};
    }
    async function request(uid, {confirmedCommunityIds = [], trusted = false, receipt: suppliedReceipt, deletedEmail = null} = {}) {
        if (typeof uid !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new HttpsError("invalid-argument", "Invalid account.");
        if (suppliedReceipt !== undefined && (typeof suppliedReceipt !== "string" || !/^[a-f0-9]{64}$/.test(suppliedReceipt))) throw new HttpsError("invalid-argument", "Invalid deletion receipt.");
        const token = suppliedReceipt || randomBytes(32).toString("hex");
        const existing = await jobs.doc(uid).get();
        if (existing.exists) {
            if (existing.data().receiptHash === hash(token)) return {accepted: true, receipt: token, ...(await status(token))};
            throw new HttpsError("failed-precondition", "Account deletion is already in progress. Use the saved receipt.");
        }
        const account = await auth.getUser(uid).catch(error => {
            if (error.code === "auth/user-not-found") return {};
            throw error;
        });
        await db.runTransaction(async tx => {
            const current = await tx.get(jobs.doc(uid));
            if (current.exists) {
                if (current.data().receiptHash === hash(token)) return;
                throw new HttpsError("failed-precondition", "Account deletion is already in progress.");
            }
            const owned = await tx.get(db.collection("communitys").where("ownerId", "==", uid));
            const profile = await tx.get(db.doc(`profiles/${uid}`));
            if (!trusted && owned.docs.some(doc => !confirmedCommunityIds.includes(doc.id))) {
                throw new HttpsError("failed-precondition", "Confirm deletion of all owned communities or transfer ownership in Community Settings first.");
            }
            tx.create(jobs.doc(uid), {phase: "drain", cursor: null, state: "pending", createdAt: Timestamp.fromMillis(now()), lastAttemptAt: Timestamp.fromMillis(0),
                notBefore: Timestamp.fromMillis(now() + graceMs), email: account.email || (trusted ? deletedEmail : null),
                username: profile.data()?.username?.toLowerCase() || null, receiptHash: hash(token)});
            tx.create(db.doc(`accountDeletionLocks/${uid}`), {createdAt: Timestamp.fromMillis(now())});
            tx.create(db.doc(`accountDeletionReceipts/${hash(token)}`), {uid, state: "pending", phase: "drain", acceptedAt: Timestamp.fromMillis(now()), earliestProcessingAt: Timestamp.fromMillis(now() + graceMs)});
        });
        return {accepted: true, receipt: token, ...(await status(token))};
    }
    async function status(token) {
        if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) throw new HttpsError("invalid-argument", "Invalid deletion receipt.");
        const receipt = await db.doc(`accountDeletionReceipts/${hash(token)}`).get();
        if (!receipt.exists) throw new HttpsError("not-found", "Deletion receipt not found.");
        const data = receipt.data();
        if (data.expiresAt?.toMillis() <= now()) return {state: 'expired'};
        const timestamps = Object.fromEntries(['acceptedAt','earliestProcessingAt','completedAt','expiresAt'].map(key => [key, data[key]?.toMillis?.() || null]));
        return {state: data.state, phase: data.phase, ...timestamps,
            needsAttention: data.state !== 'complete' && Boolean(timestamps.acceptedAt && now() - timestamps.acceptedAt > 24 * 3600000)};
    }
    async function page(job, collection, work) {
        let query = db.collection(collection).orderBy(FieldPath.documentId()).limit(PAGE_SIZE);
        if (job.cursor) query = query.startAfter(job.cursor);
        const results = await query.get();
        for (const doc of results.docs) await work(doc);
        return results.size === PAGE_SIZE ? results.docs.at(-1).id : null;
    }
    async function run(uid) {
        const ref = jobs.doc(uid), lease = randomUUID();
        const job = await db.runTransaction(async tx => {
            const snap = await tx.get(ref);
            if (!snap.exists || snap.data().state === "complete" || snap.data().leaseUntil?.toMillis() > now()) return null;
            tx.update(ref, {lease, leaseUntil: Timestamp.fromMillis(now() + 10 * 60 * 1000)});
            return snap.data();
        });
        if (!job) return;
        const receipt = db.doc(`accountDeletionReceipts/${job.receiptHash}`);
        const accountServices = {...services,
            deleteCreation: doc => services.deleteCreation(doc, uid),
            deleteCollaboration: doc => services.deleteCollaboration(doc, uid),
            prepareCommunity: ref => services.prepareCommunity?.(ref, uid),
            finishCommunity: ref => services.finishCommunity?.(ref, uid),
        };
        try {
            let cursor = null;
            const next = PHASES[PHASES.indexOf(job.phase) + 1];
            if (job.phase === "drain") {
                await auth.updateUser(uid, {disabled: true}).catch(ignoreMissingAuth);
                await auth.revokeRefreshTokens(uid).catch(ignoreMissingAuth);
                const operations = await db.collection("accountOperations").where("uid", "==", uid).get();
                const uploadDeadline = operations.docs.reduce((latest, op) => Math.max(latest, op.data().expiresAt.toMillis() + 10 * 60 * 1000), job.notBefore.toMillis());
                if (uploadDeadline > job.notBefore.toMillis()) {
                    await ref.update({notBefore: Timestamp.fromMillis(uploadDeadline)});
                    await receipt.update({earliestProcessingAt: Timestamp.fromMillis(uploadDeadline)});
                    return;
                }
                for (const op of operations.docs) {
                    if (op.data().expiresAt.toMillis() > now()) return;
                    await op.ref.delete();
                }
                if (job.notBefore.toMillis() > now()) return;
                await services.revokeCredentials(uid);
            } else if (job.phase === "collaborations") {
                cursor = await page(job, "collaborations", doc => removeAccountFromCollaboration(db, doc.ref, uid, accountServices));
            } else if (job.phase === "communities") {
                cursor = await page(job, "communitys", async doc => {
                    if (doc.data().ownerId === uid) await deleteCommunityData(db, doc.id, accountServices);
                    else await services.removeCommunityContributions(doc, uid);
                });
            } else if (job.phase === "creations") {
                const own = await db.collection("creations").where("userId", "==", uid).limit(PAGE_SIZE).get();
                for (const doc of own.docs) await services.deleteCreation(doc, uid);
                if (own.size === PAGE_SIZE) cursor = "more";
            } else if (job.phase === "references") {
                await anonymizeBallots(db, uid);
                await services.removeReferences(uid);
            } else if (job.phase === "storage") {
                await services.deleteStorage(uid);
            } else if (job.phase === "identity") {
                await services.deleteIdentity(uid, job);
            } else if (job.phase === "auth") {
                await services.verify(uid);
                await auth.deleteUser(uid).catch(ignoreMissingAuth);
                for (const collection of await db.doc(`accountDeletionLocks/${uid}`).listCollections()) await db.recursiveDelete(collection);
            }
            const update = cursor ? {cursor, state: "pending"} : next ? {phase: next, cursor: null, state: "pending"} : {state: "complete", phase: "complete"};
            await db.runTransaction(async tx => {
                const current = await tx.get(ref);
                if (current.data()?.lease !== lease) throw Error("Deletion lease lost.");
                if (update.state === "complete") {
                    tx.delete(ref); // Drop captured email, username and work state.
                    const expiresAt = Timestamp.fromMillis(now() + 30 * 86400000);
                    tx.update(db.doc(`accountDeletionLocks/${uid}`), {expiresAt});
                    tx.set(receipt, {state: "complete", phase: "complete", completedAt: Timestamp.fromMillis(now()), expiresAt});
                } else {
                    tx.update(ref, {...update, lastError: null});
                    tx.update(receipt, {state: update.state, phase: update.phase || job.phase});
                }
            });
        } catch (error) {
            // Do not store SDK messages, object paths, tokens or personal data.
            await ref.update({state: "retrying", lastError: "cleanup-failed"});
            await receipt.update({state: "retrying", phase: job.phase});
            throw error;
        } finally {
            await db.runTransaction(async tx => {
                const current = await tx.get(ref);
                if (current.data()?.lease === lease) tx.update(ref, {lease: null, leaseUntil: null});
            });
        }
    }
    return {preview, request, status, run};
}

function ignoreMissingAuth(error) { if (error.code !== "auth/user-not-found") throw error; }
module.exports = {createAccountDeletionService, anonymizeBallots};
