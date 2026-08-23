import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import MediaPreviewTile, { getYouTubeThumbnailUrl } from './MediaPreviewTile';

const provided = {
    innerRef: vi.fn(),
    draggableProps: {},
    dragHandleProps: {},
};

test('keeps the gallery image visible below a translucent Tailwind 4 overlay', () => {
    const onRemove = vi.fn();
    render(
        <MediaPreviewTile
            item={{ id: 'image-1', type: 'image', url: 'https://example.com/park.jpg' }}
            onRemove={onRemove}
            provided={provided}
        />,
    );

    expect(screen.getByAltText('Media preview')).toHaveAttribute(
        'src',
        'https://example.com/park.jpg',
    );
    expect(screen.getByTestId('media-preview-overlay')).toHaveClass('bg-black/30');
    expect(screen.getByTestId('media-preview-overlay')).not.toHaveClass('bg-opacity-30');

    fireEvent.click(screen.getByRole('button', { name: 'Remove image' }));
    expect(onRemove).toHaveBeenCalledWith('image-1', 'image');
});

test.each([
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
    'https://youtu.be/dQw4w9WgXcQ?si=preview',
    'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    'https://www.youtube.com/embed/dQw4w9WgXcQ',
    'https://www.youtube.com/live/dQw4w9WgXcQ',
])('builds a thumbnail for supported YouTube URL %s', (url) => {
    expect(getYouTubeThumbnailUrl(url)).toBe(
        'https://img.youtube.com/vi/dQw4w9WgXcQ/mqdefault.jpg',
    );
});

test('uses an error preview for an unsupported video URL', () => {
    render(
        <MediaPreviewTile
            item={{ id: 'video-1', type: 'video', url: 'https://example.com/video' }}
            onRemove={vi.fn()}
            provided={provided}
        />,
    );

    expect(screen.getByAltText('Media preview')).toHaveAttribute(
        'src',
        'https://placehold.co/400x225/333333/ffffff?text=Error',
    );
});
