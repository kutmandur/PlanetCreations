import { describe, expect, test } from 'vitest';
import {
    buildCreationEditNavigationState,
    wasOpenedFromCreationDetail,
    buildModerationEditNavigationState,
    wasOpenedFromModeration,
} from './creationNavigation';

describe('creation edit navigation', () => {
    test('moderation returns only from the matching creation editor',()=>{
        const state=buildModerationEditNavigationState('creation-1');
        expect(wasOpenedFromModeration(state,'creation-1')).toBe(true);
        expect(wasOpenedFromModeration(state,'creation-2')).toBe(false);
        expect(wasOpenedFromCreationDetail(state,'creation-1')).toBe(false);
        expect(wasOpenedFromModeration(null,'creation-1')).toBe(false);
    });
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
