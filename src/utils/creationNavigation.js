const CREATION_DETAIL_ORIGIN_KEY = 'creationDetailOriginId';

export const buildCreationEditNavigationState = (creationId) => ({
    [CREATION_DETAIL_ORIGIN_KEY]: String(creationId),
});

export const wasOpenedFromCreationDetail = (navigationState, creationId) => (
    navigationState?.[CREATION_DETAIL_ORIGIN_KEY] === String(creationId)
);
