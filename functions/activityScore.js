const {Timestamp} = require('firebase-admin/firestore');
async function recordCreationActivity(db, change) {
    if ((change.after.data().changelog || []).length <= (change.before.data().changelog || []).length) return;
    // Use the immutable Firestore update time. A delayed retry must not earn
    // another daily activity point simply because it was delivered a day later.
    const eventAt = change.after.updateTime?.toMillis();
    if (!Number.isFinite(eventAt)) throw new Error('Creation activity requires the source update time.');
    await db.runTransaction(async tx => {
        const latest = await tx.get(change.after.ref);
        if (!latest.exists) return;
        const data = latest.data();
        const lastAt = data.activityAt?.toMillis?.() || 0;
        if (eventAt - lastAt < 20 * 60 * 60 * 1000) return;
        const elapsed = Math.max(0, eventAt - lastAt);
        const decayed = lastAt ? (data.activityScore || 0) * Math.pow(0.7, elapsed / (30 * 86400000)) * Math.pow(0.2, elapsed / (365 * 86400000)) : 0;
        tx.update(change.after.ref, {activityScore: Math.round((decayed + 1) * 100) / 100, activityAt: Timestamp.fromMillis(eventAt)});
    });
}
module.exports = {recordCreationActivity};
