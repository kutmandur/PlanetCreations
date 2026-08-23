import { describe, expect, test } from 'vitest';
import {
    buildCreationEditNavigationState,
    wasOpenedFromCreationDetail,
} from './creationNavigation';

describe('creation edit navigation', () => {
    test('recognizes the matching creation detail page as the edit origin', () => {
        const state = buildCreationEditNavigationState('creation-1');

        expect(wasOpenedFromCreationDetail(state, 'creation-1')).toBe(true);
    });

    test('does not reuse history for direct or mismatched edit links', () => {
        expect(wasOpenedFromCreationDetail(null, 'creation-1')).toBe(false);
        expect(wasOpenedFromCreationDetail(
            buildCreationEditNavigationState('creation-2'),
            'creation-1',
        )).toBe(false);
    });
});
