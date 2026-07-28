import { getFunctions, httpsCallable } from 'firebase/functions';
import {
    isDiscordAuthorizationUrl,
    requestDiscordLinkUrl,
    unlinkDiscordAccount,
} from './discord';

vi.mock('firebase/functions', () => ({
    getFunctions: vi.fn(() => 'functions'),
    httpsCallable: vi.fn(),
}));

describe('Discord Firebase service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getFunctions.mockReturnValue('functions');
    });

    it('accepts only the expected Discord authorization endpoint', () => {
        expect(isDiscordAuthorizationUrl(
            'https://discord.com/api/oauth2/authorize?state=opaque',
        )).toBe(true);
        expect(isDiscordAuthorizationUrl(
            'https://discord.com.evil.invalid/api/oauth2/authorize',
        )).toBe(false);
        expect(isDiscordAuthorizationUrl(
            'http://discord.com/api/oauth2/authorize',
        )).toBe(false);
    });

    it('requests an opaque server-created authorization URL', async () => {
        const callable = vi.fn().mockResolvedValue({
            data: {
                authUrl:
                    'https://discord.com/api/oauth2/authorize?state=opaque',
            },
        });
        httpsCallable.mockReturnValue(callable);

        await expect(requestDiscordLinkUrl()).resolves.toContain(
            'state=opaque',
        );
        expect(httpsCallable).toHaveBeenCalledWith(
            'functions',
            'startDiscordLink',
        );
        expect(callable).toHaveBeenCalledWith();
    });

    it('rejects a server response that points outside Discord', async () => {
        httpsCallable.mockReturnValue(vi.fn().mockResolvedValue({
            data: {authUrl: 'https://example.invalid/oauth'},
        }));
        await expect(requestDiscordLinkUrl()).rejects.toThrow(
            'invalid Discord authorization URL',
        );
    });

    it('unlinks through the server instead of writing provider fields', async () => {
        const callable = vi.fn().mockResolvedValue({
            data: {success: true},
        });
        httpsCallable.mockReturnValue(callable);

        await expect(unlinkDiscordAccount()).resolves.toEqual({
            success: true,
        });
        expect(httpsCallable).toHaveBeenCalledWith(
            'functions',
            'unlinkDiscordAccount',
        );
    });
});
