import { describe, expect, it } from 'vitest';
import {
    buildOverlayShowcaseEntry,
    clearOverlayShowcaseChecklist,
    isOverlayShowcaseEntry,
    overlayShowcasePayload,
    readOverlayShowcaseChecklist,
    selectOverlayShowcaseCreation,
    writeOverlayShowcaseChecklist,
} from './overlayShowcase';

describe('overlay showcases', () => {
    it('deduplicates creations and selects the requested active creation', () => {
        const entry = buildOverlayShowcaseEntry({
            communityId: 'community-1',
            showcaseId: 'group-1',
            showcaseTitle: 'Summer builds',
            creations: [
                { id: 'park-1', title: 'Park' },
                { id: 'ride-2', title: 'Blueprint' },
                { id: 'ride-2', title: 'Duplicate' },
            ],
            activeCreationId: 'ride-2',
            enabledAt: 123,
        });

        expect(entry.creationIds).toEqual(['park-1', 'ride-2']);
        expect(entry.creationId).toBe('ride-2');
        expect(entry.url).toContain('/share/creation/ride-2');
        expect(isOverlayShowcaseEntry(entry)).toBe(true);
    });

    it('changes the active QR without losing the showcase selection', () => {
        const entry = buildOverlayShowcaseEntry({
            communityId: 'community-1',
            creations: [{ id: 'one', title: 'One' }, { id: 'two', title: 'Two' }],
        });
        const selected = selectOverlayShowcaseCreation(entry, { id: 'two', title: 'Second ride' });

        expect(selected.creationIds).toEqual(['one', 'two']);
        expect(selected.creationId).toBe('two');
        expect(selected.title).toBe('Second ride');
        expect(overlayShowcasePayload(selected)).toMatchObject({
            communityId: 'community-1',
            creationIds: ['one', 'two'],
            activeCreationId: 'two',
        });
    });

    it('keeps ride checklist state local to the active showcase', () => {
        const first = buildOverlayShowcaseEntry({
            communityId: 'community-1',
            showcaseId: 'group-1',
            creations: [{ id: 'park-1', title: 'Park' }],
        });
        const second = buildOverlayShowcaseEntry({
            communityId: 'community-1',
            showcaseId: 'group-2',
            creations: [{ id: 'park-1', title: 'Park' }],
        });

        writeOverlayShowcaseChecklist(first, { 'park-1': ['ride-a'] });
        expect(readOverlayShowcaseChecklist(first)).toEqual({ 'park-1': ['ride-a'] });
        expect(readOverlayShowcaseChecklist(second)).toEqual({});

        clearOverlayShowcaseChecklist();
        expect(readOverlayShowcaseChecklist(first)).toEqual({});
    });
});
