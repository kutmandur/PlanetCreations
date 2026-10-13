import { describe, expect, it } from 'vitest';
import { getDiscordProfileUrl } from './discordProfile';

describe('Discord profile links', () => {
    it.each(['123456789012345678', ' https://discord.com/users/123456789012345678/ '])('normalizes %s', input => {
        expect(getDiscordProfileUrl(input)).toBe('https://discord.com/users/123456789012345678');
    });
    it.each(['clwd_n9n3', '', null, 'https://discord.com.evil.test/users/123456789012345678', 'https://discord.gg/invite', '123', 'javascript:alert(1)'])('does not link invalid value %s', input => {
        expect(getDiscordProfileUrl(input)).toBeNull();
    });
});
