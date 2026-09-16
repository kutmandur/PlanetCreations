const {FieldValue} = require("firebase-admin/firestore");
async function countReport(db, snap) {
        const r = snap.data();
        if (!r || !r.targetId || !r.targetType) return null;
        const col = r.targetType === 'creation' ? 'creations'
            : (r.targetType === 'user' ? 'users' : null);
        if (!col) return null;
        await db.runTransaction(async tx => {
            const latest = await tx.get(snap.ref);
            const target = await tx.get(db.doc(`${col}/${r.targetId}`));
            if (!latest.exists || latest.data().countedAt || !target.exists) return;
            tx.update(target.ref, {reportCount: FieldValue.increment(1)});
            tx.update(snap.ref, {countedAt: FieldValue.serverTimestamp()});
        });
        return null;
}
module.exports = {countReport};
