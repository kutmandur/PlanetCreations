import { describe, expect, it } from 'vitest';
import { buildCreationShareUrl } from './overlayQr';

describe('Creation share links', () => {
    it('uses the server-rendered preview route instead of an invisible hash fragment', () => {
        expect(buildCreationShareUrl('GP61an1czVXbQYkVaenh')).toBe(
            'https://www.planetcreations.net/share/creation/GP61an1czVXbQYkVaenh',
        );
    });

    it('encodes unsafe URL characters', () => {
        expect(buildCreationShareUrl('creation with spaces')).toBe(
            'https://www.planetcreations.net/share/creation/creation%20with%20spaces',
        );
    });
});
