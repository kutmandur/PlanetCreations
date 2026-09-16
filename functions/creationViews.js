"use strict";
const {createHash} = require("node:crypto");
const {safeId} = require("./eventVoting");
const hash = value => createHash("sha256").update(value).digest("hex");
const fail = (code, message) => { throw Object.assign(new Error(message), {code}); };
async function recordCreationView(db, input, identity, {aggregate = false, now = Date.now()} = {}) {
    if (!safeId(input?.creationId) || !/^[a-f0-9]{64}$/.test(input?.sessionToken || "")) fail("invalid-argument", "Invalid view session.");
    const ref = db.doc(`creations/${input.creationId}`);
    const sessionRef = db.doc(`viewSessions/${hash(input.sessionToken)}`);
    const rateRef = db.doc(`securityRateLimits/${hash(`view:${identity}`)}`);
    const statRef = db.doc(`creationStats/${input.creationId}`);
    return db.runTransaction(async tx => {
        const session = await tx.get(sessionRef);
        const seen = session.data()?.seen || [];
        if (seen.includes(input.creationId)) return {counted: false};
        const [creation, rate, stat] = await Promise.all([tx.get(ref), tx.get(rateRef), tx.get(statRef)]);
        if (!creation.exists) fail("not-found", "Creation not found.");
        if (seen.length >= 1000) fail("resource-exhausted", "This view session has reached its limit.");
        const windowStart = rate.data()?.windowStart || 0;
        const count = now - windowStart < 60000 ? rate.data()?.count || 0 : 0;
        if (count >= 120) fail("resource-exhausted", "Please wait before opening more creations.");
        const views = Math.max(creation.data().views || 0, stat?.data()?.views || 0) + 1;
        tx.set(sessionRef, {seen: [...seen, input.creationId], expiresAt: new Date(now + 7 * 86400000)});
        tx.set(rateRef, {windowStart: count ? windowStart : now, count: count + 1, expiresAt: new Date(now + 3600000)});
        if (aggregate) tx.set(statRef, {views, dirty: true, dirtySince: stat.data()?.dirtySince || new Date(now)});
        else {
            tx.update(ref, {views});
            // Existing aggregate state remains authoritative during a rolling config change.
            if (stat.exists) tx.set(statRef, {views, dirty: false, dirtySince: null});
        }
        return {counted: true, views};
    });
}
async function publishViewTotals(db) {
    const pending = await db.collection("creationStats").where("dirty", "==", true).orderBy("dirtySince").limit(400).get();
    for (const stat of pending.docs) await db.runTransaction(async tx => {
        const creationRef = db.doc(`creations/${stat.id}`);
        const [latest, creation] = await Promise.all([tx.get(stat.ref), tx.get(creationRef)]);
        if (!latest.data()?.dirty) return;
        if (!creation.exists) { tx.delete(stat.ref); return; }
        tx.update(creationRef, {views: Math.max(creation.data().views || 0, latest.data().views || 0)});
        tx.update(stat.ref, {dirty: false, dirtySince: null});
    });
    return pending.size;
}
module.exports = {recordCreationView, publishViewTotals};
