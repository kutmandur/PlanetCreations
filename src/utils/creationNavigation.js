const CREATION_DETAIL_ORIGIN_KEY = 'creationDetailOriginId';

export const buildCreationEditNavigationState = (creationId) => ({
    [CREATION_DETAIL_ORIGIN_KEY]: String(creationId),
});

export const wasOpenedFromCreationDetail = (navigationState, creationId) => (
    navigationState?.[CREATION_DETAIL_ORIGIN_KEY] === String(creationId)
);

export const buildModerationEditNavigationState = creationId => ({moderationCreationId:String(creationId)});
export const wasOpenedFromModeration = (state, creationId) => state?.moderationCreationId === String(creationId);
