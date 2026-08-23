import React from 'react';
import { getYoutubeThumbnailUrl, ICONS } from '../../utils/helpers';
import Icon from './Icon';

const ERROR_PREVIEW_URL =
    'https://placehold.co/400x225/333333/ffffff?text=Error';

export function getYouTubeThumbnailUrl(rawUrl) {
    return getYoutubeThumbnailUrl(rawUrl, 'mqdefault');
}

const MediaPreviewTile = ({ item, onRemove, provided }) => {
    const isVideo = item.type === 'video';
    const thumbnailUrl = isVideo
        ? getYouTubeThumbnailUrl(item.url) || ERROR_PREVIEW_URL
        : item.url;

    return (
        <div
            ref={provided.innerRef}
            {...provided.draggableProps}
            {...provided.dragHandleProps}
            className="group relative h-24 w-40 flex-shrink-0 overflow-hidden rounded-lg"
        >
            <img
                src={thumbnailUrl}
                alt="Media preview"
                className="h-full w-full object-cover"
                onError={(event) => {
                    event.currentTarget.onerror = null;
                    event.currentTarget.src = ERROR_PREVIEW_URL;
                }}
            />
            <div
                data-testid="media-preview-overlay"
                className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30"
            >
                <Icon path={isVideo ? ICONS.video : ICONS.image} className="h-8 w-8 text-white" />
            </div>
            <button
                type="button"
                onClick={() => onRemove(item.id, item.type)}
                aria-label={`Remove ${isVideo ? 'video' : 'image'}`}
                className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-colors hover:bg-red-500 group-hover:opacity-100"
            >
                &times;
            </button>
        </div>
    );
};

export default MediaPreviewTile;
