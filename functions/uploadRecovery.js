"use strict";
function isClaimableUpload(session, now = Date.now()) {
    if (!session) return false;
    const expires = session.expiresAt?.toMillis?.() || 0;
    if (session.status === "pending") return expires > now;
    // Functions time out after five minutes; allow recovery only after twice that interval.
    return session.status === "processing" &&
        now - (session.processingAt?.toMillis?.() || now) > 10 * 60000 && now < expires + 86400000;
}
// Set the terminal state before cleanup, fencing off retries/other requests.
// If the commit outcome cannot be read, retain the object for reconciliation.
async function settleFailedUpload(db, ref, token, error) {
    return db.runTransaction(async tx => {
        const snapshot = await tx.get(ref);
        const data = snapshot.data();
        if (data?.status === "completed") return {completed: true, ...data};
        if (!data || data.processingToken !== token || data.status !== "processing") return {cleanup: false};
        tx.update(ref, {status: "rejected", error: String(error.message).slice(0, 400), failedAt: new Date()});
        return {cleanup: true};
    });
}
module.exports = {isClaimableUpload, settleFailedUpload};
