"use strict";
const {callableWith, scheduled, functions} = require("./runtime");
const {onUserDeleted} = require("firebase-functions/v2/identity");
const {createAccountDeletionService} = require("./accountDeletion");

function accountDeletionEndpoints(options, secrets) {
    const service = createAccountDeletionService(options);
    const requireAuth = context => {
        if (!context.auth) throw new functions.https.HttpsError("unauthenticated", "Sign in first.");
        return context.auth.uid;
    };
    const request = callableWith({allowDeletingAccount: true}, async (data, context) => {
        const uid = requireAuth(context);
        if (Date.now() / 1000 - Number(context.auth.token.auth_time || 0) > 300) {
            throw new functions.https.HttpsError("unauthenticated", "Sign in again before deleting your account.");
        }
        if (data?.protocolVersion !== 2) throw new functions.https.HttpsError("failed-precondition", "Update the app to confirm community deletion and track account deletion.");
        return service.request(uid, {confirmedCommunityIds: data.confirmedCommunityIds || [], receipt: data.receipt});
    });
    return {
        service,
        exports: {
            deleteOwnAccount: request,
            getAccountDeletionPreview: callableWith({allowDeletingAccount: true}, (data, context) => {
                const uid = requireAuth(context);
                if (data?.userId && data.userId !== uid && context.auth.token.role !== "admin") throw new functions.https.HttpsError("permission-denied", "Administrator permission required.");
                return service.preview(data?.userId || uid);
            }),
            getAccountDeletionStatus: callableWith({allowDeletingAccount: true}, data => service.status(data?.receipt)),
            deleteUserAndContent: callableWith({}, async (data, context) => {
                const uid = requireAuth(context);
                if (context.auth.token.role !== "admin" || data?.userIdToDelete === uid) throw new functions.https.HttpsError("permission-denied", "Administrator permission required.");
                if (data?.protocolVersion !== 2) throw new functions.https.HttpsError("failed-precondition", "Update the app to use the asynchronous account deletion workflow.");
                return service.request(data?.userIdToDelete, {confirmedCommunityIds: data?.confirmedCommunityIds || []});
            }),
            resumeAccountDeletions: scheduled({schedule: "every 1 minutes", timeoutSeconds: 540, secrets}, async () => {
                // A bounded round-robin avoids starving later jobs when an external
                // provider keeps failing. Phases are checkpointed independently.
                const jobs = await options.db.collection("accountDeletionJobs").orderBy("lastAttemptAt").limit(5).get();
                for (const job of jobs.docs) {
                    if (job.data().createdAt?.toMillis() < Date.now() - 24 * 3600000) console.error('ACCOUNT_DELETION_OVERDUE', {phase: job.data().phase});
                    await job.ref.update({lastAttemptAt: new Date()});
                    try { await service.run(job.id); }
                    catch { console.error("Account deletion phase will retry."); }
                }
            }),
            onAuthAccountDeleted: onUserDeleted({retry: true}, async event => {
                const uid = event.data.uid;
                if ((await options.db.doc(`accountDeletionLocks/${uid}`).get()).exists) return;
                // Covers console/Admin SDK deletion. Interactive clients must use
                // the callable, which obtains the community owner's confirmation.
                await service.request(uid, {trusted: true, deletedEmail: event.data.email || null});
            }),
        },
    };
}
module.exports = {accountDeletionEndpoints};
