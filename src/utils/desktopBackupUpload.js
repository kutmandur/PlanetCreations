import { getFunctions, httpsCallable } from 'firebase/functions';

// A missing capability can also mean that an already-open desktop window still
// has the previous hosted Workshop bundle loaded. Do not call the installed
// client outdated based on capability detection alone.
export const DESKTOP_UPLOAD_BRIDGE_UNAVAILABLE_MESSAGE =
    'The desktop upload bridge is unavailable. Reload the Workshop or restart the PlanetCreations desktop client.';

export const supportsDesktopBackupUpload = (api) =>
    typeof api?.prepareBackupForUpload === 'function' &&
    (typeof api.uploadPreparedBackup === 'function' ||
        typeof api.uploadBackupFile === 'function');

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
