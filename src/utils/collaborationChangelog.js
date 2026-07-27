const timestampToMillis = (value) => {
    if (typeof value?.toMillis === 'function') return value.toMillis();
    if (Number.isFinite(value?.seconds)) return value.seconds * 1000;
    if (Number.isFinite(value)) return value;
    const parsed = value ? new Date(value).getTime() : 0;
    return Number.isFinite(parsed) ? parsed : 0;
};

export const buildCollaborationGalleryItems = (entries = [], projectGallery = {}) => {
    const changelogItems = [...entries]
        .sort((a, b) => timestampToMillis(b.createdAt) - timestampToMillis(a.createdAt))
        .flatMap((entry) => (
            (entry.imageUrls || []).map((url, imageIndex) => ({
                id: `${entry.id}-${imageIndex}`,
                url,
                entryId: entry.id,
                text: entry.changelog,
                username: entry.username,
                createdAt: entry.createdAt,
                versionId: entry.versionId,
                versionNumber: entry.versionNumber,
            }))
        ));
    const startingItems = (projectGallery.imageUrls || []).map((url, imageIndex) => ({
        id: `project-gallery-${imageIndex}`,
        url,
        entryId: null,
        text: projectGallery.text || 'Starting gallery image',
        username: projectGallery.username || 'Collaboration owner',
        createdAt: projectGallery.createdAt,
        versionId: null,
        versionNumber: null,
    }));
    return [...changelogItems, ...startingItems];
};
