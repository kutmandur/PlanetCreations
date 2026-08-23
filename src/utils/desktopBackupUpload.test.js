import { getFunctions, httpsCallable } from 'firebase/functions';
import {
    supportsDesktopBackupUpload,
    uploadPreparedDesktopBackup,
} from './desktopBackupUpload';

vi.mock('firebase/functions', () => ({
    getFunctions: vi.fn(() => 'functions-instance'),
    httpsCallable: vi.fn(),
}));

describe('desktop backup upload compatibility', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    test('prefers the capability-scoped upload handle on current clients', async () => {
        const api = {
            prepareBackupForUpload: vi.fn(),
            uploadPreparedBackup: vi.fn().mockResolvedValue({ success: true, uploadId: 'modern-id' }),
            uploadBackupFile: vi.fn(),
        };

        expect(supportsDesktopBackupUpload(api)).toBe(true);
        const result = await uploadPreparedDesktopBackup({
            api,
            preparedBackup: { uploadHandle: 'opaque-handle' },
            idToken: 'id-token',
            appCheckToken: 'app-check-token',
            ownershipConfirmed: true,
            hostingAccepted: true,
        });

        expect(result).toEqual({ success: true, uploadId: 'modern-id' });
        expect(api.uploadPreparedBackup).toHaveBeenCalledWith(
            'opaque-handle',
            'id-token',
            'app-check-token',
            { ownershipConfirmed: true, hostingAccepted: true },
        );
        expect(api.uploadBackupFile).not.toHaveBeenCalled();
        expect(httpsCallable).not.toHaveBeenCalled();
    });

    test('keeps the released legacy desktop upload path compatible', async () => {
        const getUploadUrl = vi.fn().mockResolvedValue({
            data: {
                uploadId: 'legacy-id',
                uploadUrl: 'https://uploads.example.test/signed',
                contentType: 'application/zip',
            },
        });
        httpsCallable.mockReturnValue(getUploadUrl);
        const api = {
            prepareBackupForUpload: vi.fn(),
            uploadBackupFile: vi.fn().mockResolvedValue({ success: true }),
        };

        expect(supportsDesktopBackupUpload(api)).toBe(true);
        const result = await uploadPreparedDesktopBackup({
            api,
            preparedBackup: {
                filePath: 'C:\\Temp\\upload.PlanetCreations',
                fileName: 'upload.PlanetCreations',
                fileSize: 4096,
            },
            idToken: 'unused-by-legacy-bridge',
            appCheckToken: null,
            ownershipConfirmed: true,
            hostingAccepted: true,
        });

        expect(getFunctions).toHaveBeenCalled();
        expect(httpsCallable).toHaveBeenCalledWith('functions-instance', 'getUploadUrl');
        expect(getUploadUrl).toHaveBeenCalledWith({
            fileName: 'upload.PlanetCreations',
            fileSize: 4096,
            ownershipConfirmed: true,
            hostingAccepted: true,
        });
        expect(api.uploadBackupFile).toHaveBeenCalledWith(
            'C:\\Temp\\upload.PlanetCreations',
            'https://uploads.example.test/signed',
            'application/zip',
        );
        expect(result).toEqual({ success: true, uploadId: 'legacy-id' });
    });
});
