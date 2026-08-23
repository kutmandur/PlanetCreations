import { getFunctions, httpsCallable } from 'firebase/functions';

export const supportsDesktopBackupUpload = (api) => Boolean(
    api?.prepareBackupForUpload &&
    (api.uploadPreparedBackup || api.uploadBackupFile),
);

const abortLegacyUpload = async (uploadId) => {
    if (!uploadId) return;
    const abortUpload = httpsCallable(getFunctions(), 'abortBackupUpload');
    await abortUpload({ uploadId }).catch(() => null);
};

export const uploadPreparedDesktopBackup = async ({
    api,
    preparedBackup,
    idToken,
    appCheckToken,
    ownershipConfirmed,
    hostingAccepted,
}) => {
    if (typeof api?.uploadPreparedBackup === 'function') {
        if (!preparedBackup?.uploadHandle) {
            throw new Error('The desktop client did not return a valid upload handle.');
        }
        return api.uploadPreparedBackup(
            preparedBackup.uploadHandle,
            idToken,
            appCheckToken,
            { ownershipConfirmed, hostingAccepted },
        );
    }

    if (typeof api?.uploadBackupFile !== 'function' || !preparedBackup?.filePath) {
        throw new Error('This desktop client cannot upload local files.');
    }

    const getUploadUrl = httpsCallable(getFunctions(), 'getUploadUrl');
    const { data: uploadSession } = await getUploadUrl({
        fileName: preparedBackup.fileName,
        fileSize: preparedBackup.fileSize,
        ownershipConfirmed,
        hostingAccepted,
    });

    try {
        const result = await api.uploadBackupFile(
            preparedBackup.filePath,
            uploadSession.uploadUrl,
            uploadSession.contentType,
        );
        if (!result?.success) await abortLegacyUpload(uploadSession.uploadId);
        return { ...result, uploadId: uploadSession.uploadId };
    } catch (error) {
        await abortLegacyUpload(uploadSession.uploadId);
        throw error;
    }
};
