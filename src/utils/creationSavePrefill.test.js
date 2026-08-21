import {
    buildSavegamePrefill,
    getVerifiedGameTags,
    getCreationWizardSteps,
    inferCreationCategory,
} from './creationSavePrefill';

test('puts the savegame decision first only for new desktop creations', () => {
    expect(getCreationWizardSteps({ isDesktopClient: true, isEdit: false }).map(step => step.id))
        .toEqual(['source', 'details', 'savegame', 'media', 'sharing']);
    expect(getCreationWizardSteps({ isDesktopClient: false, isEdit: false }).map(step => step.id))
        .toEqual(['details', 'savegame', 'media', 'sharing']);
    expect(getCreationWizardSteps({ isDesktopClient: true, isEdit: true }).map(step => step.id))
        .toEqual(['details', 'savegame', 'media', 'sharing']);
    expect(getCreationWizardSteps({ isDesktopClient: true, isEdit: false, category: 'Park' }).map(step => step.id))
        .toEqual(['source', 'details', 'rides-areas', 'savegame', 'media', 'sharing']);
    expect(getCreationWizardSteps({ isDesktopClient: false, isEdit: true, category: 'Parks' }).map(step => step.id))
        .toEqual(['details', 'rides-areas', 'savegame', 'media', 'sharing']);
});

test('builds editable wizard defaults from extracted save metadata', () => {
    const prefill = buildSavegamePrefill({
        name: 'technical-name.blpr2',
        frontierMetadata: {
            kind: 'blueprint',
            name: 'Frost Giant Reach',
            description: 'A frozen launch coaster.',
            isModded: false,
            requiredDlcs: ['Vintage Funfair Ride Pack'],
            tags: ['Blueprint', 'Coasters', 'Menu_Winter_Theme'],
            blueprint: {
                trackedRideCount: 1,
                rides: [{ kind: 'tracked', rideCategoryKey: 'coaster' }],
            },
        },
    }, ['Park', 'Coaster', 'Flatride', 'Scenery']);

    expect(prefill).toMatchObject({
        gameId: 'planet-coaster-2',
        title: 'Frost Giant Reach',
        description: 'A frozen launch coaster.',
        category: 'Coaster',
        requiredDlcs: ['Vintage Funfair Ride Pack'],
        usesMods: false,
        gameTags: ['Coasters', 'Winter Theme'],
    });
});

test('recognizes parks and reads verified game tags separately from user tags', () => {
    expect(inferCreationCategory({ kind: 'park' }, ['Scenery', 'Park'])).toBe('Park');
    expect(getVerifiedGameTags({
        tags: ['handmade', 'alpine'],
        verifiedGameMetadata: {
            metadata: { tags: ['Blueprint', 'Coasters', 'Menu_Winter_Theme'] },
        },
    })).toEqual(['Coasters', 'Winter Theme']);
});
