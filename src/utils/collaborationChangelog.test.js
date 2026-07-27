import { buildCollaborationGalleryItems } from './collaborationChangelog';

describe('buildCollaborationGalleryItems', () => {
    test('fills the gallery from changelog image URLs with newest entries first', () => {
        const gallery = buildCollaborationGalleryItems([
            {
                id: 'older',
                changelog: 'Older update',
                createdAt: { seconds: 10 },
                imageUrls: ['https://example.com/older.jpg'],
                versionId: 'version-1',
                versionNumber: 1,
            },
            {
                id: 'newer',
                changelog: 'Newer update',
                createdAt: { seconds: 20 },
                imageUrls: [
                    'https://example.com/newer-a.jpg',
                    'https://example.com/newer-b.jpg',
                ],
                versionId: 'version-2',
                versionNumber: 2,
            },
        ]);

        expect(gallery.map((item) => item.url)).toEqual([
            'https://example.com/newer-a.jpg',
            'https://example.com/newer-b.jpg',
            'https://example.com/older.jpg',
        ]);
        expect(gallery[0]).toMatchObject({
            entryId: 'newer',
            versionId: 'version-2',
            versionNumber: 2,
        });
    });

    test('appends owner-provided starting images after the newest changelog images', () => {
        const gallery = buildCollaborationGalleryItems(
            [{
                id: 'update',
                changelog: 'Newest update',
                createdAt: { seconds: 20 },
                imageUrls: ['https://example.com/update.jpg'],
            }],
            {
                imageUrls: [
                    'https://example.com/starting-a.jpg',
                    'https://example.com/starting-b.jpg',
                ],
                username: 'Project owner',
                text: 'Starting gallery',
                createdAt: { seconds: 10 },
            },
        );

        expect(gallery.map((item) => item.url)).toEqual([
            'https://example.com/update.jpg',
            'https://example.com/starting-a.jpg',
            'https://example.com/starting-b.jpg',
        ]);
        expect(gallery[1]).toMatchObject({
            entryId: null,
            username: 'Project owner',
            text: 'Starting gallery',
            versionId: null,
        });
    });
});
