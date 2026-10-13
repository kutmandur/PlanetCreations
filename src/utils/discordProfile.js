// Discord profile URLs require a numeric user ID, not a username.
export function getDiscordProfileUrl(value) {
    const input = typeof value === 'string' ? value.trim() : '';
    const match = input.match(/^(?:https:\/\/(?:www\.)?discord\.com\/users\/)?([0-9]{17,20})\/?$/);
    return match ? 'https://discord.com/users/' + match[1] : null;
}
