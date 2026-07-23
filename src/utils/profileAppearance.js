export const DEFAULT_PROFILE_COLOR = '#6B7280';

export const isValidProfileColor = (value) =>
    typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);

export const normalizeProfileColor = (value) =>
    isValidProfileColor(value) ? value : DEFAULT_PROFILE_COLOR;

const darkenProfileColor = (hex, factor = 0.82) => {
    const channels = [1, 3, 5].map((start) =>
        Math.round(parseInt(hex.slice(start, start + 2), 16) * factor)
            .toString(16)
            .padStart(2, '0')
    );

    return `#${channels.join('')}`;
};

export const getProfileAppearance = (value) => {
    const hex = normalizeProfileColor(value);
    const hoverHex = darkenProfileColor(hex);

    return {
        hex,
        hoverHex,
        style: {
            '--game-color': hex,
            '--game-color-hover': hoverHex,
            '--profile-color': hex,
        },
    };
};
