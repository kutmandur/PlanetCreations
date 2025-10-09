import React from 'react';
import { DragDropContext, Droppable, Draggable } from 'react-beautiful-dnd';
import Icon from '../ui/Icon';
import InfoBox from '../ui/InfoBox';
import { ICONS } from '../../utils/helpers';

const MediaPreview = ({ item, onRemove, provided }) => {
    const getYoutubeThumbnail = (url) => {
        if (!url) return null;
        const videoIdMatch = url.match(/(?:v=|\/)([a-zA-Z0-9_-]{11})(?:\?|&|$)/);
        const videoId = videoIdMatch ? videoIdMatch[1] : url.split('/').pop();
        return `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    };
    const isVideo = item.type === 'video';
    const thumbnailUrl = isVideo ? getYoutubeThumbnail(item.url) : item.url;
    return (
        <div ref={provided.innerRef} {...provided.draggableProps} {...provided.dragHandleProps} className="w-40 h-24 rounded-lg overflow-hidden relative group flex-shrink-0">
            <img src={thumbnailUrl} alt="Media preview" className="w-full h-full object-cover" onError={(e) => { e.target.onerror = null; e.target.src = 'https://placehold.co/400x225/333333/ffffff?text=Error'; }} />
            <div className="absolute inset-0 bg-black bg-opacity-30 flex items-center justify-center">
                <Icon path={isVideo ? ICONS.video : ICONS.image} className="w-8 h-8 text-white" />
            </div>
            <button type="button" onClick={() => onRemove(item.id, item.type)} className="absolute top-1 right-1 w-6 h-6 bg-black bg-opacity-50 text-white rounded-full flex items-center justify-center hover:bg-red-500 transition-colors opacity-0 group-hover:opacity-100">&times;</button>
        </div>
    );
};

const EventGalleries = ({ imageItems, videoItems, handleMediaPaste, handleMediaDragEnd, handleRemoveMedia, IMAGE_LIMIT, VIDEO_LIMIT }) => {
    return (
        <>
            <div>
                <label className="block text-gray-700 font-bold mb-2">Event Gallery Images</label>
                <div className="p-3 border rounded-lg">
                    <textarea onPaste={(e) => handleMediaPaste(e, 'image')} rows="3" className="w-full p-2 border rounded-md disabled:bg-gray-100" placeholder={imageItems.length >= IMAGE_LIMIT ? `Maximum of ${IMAGE_LIMIT} images reached.` : `Paste up to ${IMAGE_LIMIT - imageItems.length} image links...`} disabled={imageItems.length >= IMAGE_LIMIT} />
                    <div className="mt-2"><InfoBox /></div>
                </div>
            </div>
            {imageItems.length > 0 && (
                <DragDropContext onDragEnd={(result) => handleMediaDragEnd(result, 'image')}>
                    <Droppable droppableId="image-gallery" direction="horizontal">
                        {(provided) => (
                            <div {...provided.droppableProps} ref={provided.innerRef} className="p-3 border rounded-lg bg-gray-50 flex items-center gap-4 overflow-x-auto">
                                {imageItems.map((item, index) => (
                                    <Draggable key={item.id} draggableId={item.id} index={index}>{(provided) => (<MediaPreview item={item} onRemove={handleRemoveMedia} provided={provided} />)}</Draggable>
                                ))}
                                {provided.placeholder}
                            </div>
                        )}
                    </Droppable>
                </DragDropContext>
            )}
            <div>
                <label className="block text-gray-700 font-bold mb-2">Event Gallery YouTube Videos</label>
                <div className="p-3 border rounded-lg">
                    <textarea onPaste={(e) => handleMediaPaste(e, 'video')} rows="3" className="w-full p-2 border rounded-md disabled:bg-gray-100" placeholder={videoItems.length >= VIDEO_LIMIT ? `Maximum of ${VIDEO_LIMIT} videos reached.` : `Paste up to ${VIDEO_LIMIT - videoItems.length} YouTube links...`} disabled={videoItems.length >= VIDEO_LIMIT} />
                </div>
            </div>
            {videoItems.length > 0 && (
                <DragDropContext onDragEnd={(result) => handleMediaDragEnd(result, 'video')}>
                    <Droppable droppableId="video-gallery" direction="horizontal">
                        {(provided) => (
                            <div {...provided.droppableProps} ref={provided.innerRef} className="p-3 border rounded-lg bg-gray-50 flex items-center gap-4 overflow-x-auto">
                                {videoItems.map((item, index) => (
                                    <Draggable key={item.id} draggableId={item.id} index={index}>{(provided) => (<MediaPreview item={item} onRemove={handleRemoveMedia} provided={provided} />)}</Draggable>
                                ))}
                                {provided.placeholder}
                            </div>
                        )}
                    </Droppable>
                </DragDropContext>
            )}
        </>
    );
};

export default EventGalleries;