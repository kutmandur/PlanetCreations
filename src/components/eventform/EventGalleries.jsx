import React from 'react';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import InfoBox from '../ui/InfoBox';
import MediaPreviewTile from '../ui/MediaPreviewTile';

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
                                    <Draggable key={item.id} draggableId={item.id} index={index}>{(provided) => (<MediaPreviewTile item={item} onRemove={handleRemoveMedia} provided={provided} />)}</Draggable>
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
                                    <Draggable key={item.id} draggableId={item.id} index={index}>{(provided) => (<MediaPreviewTile item={item} onRemove={handleRemoveMedia} provided={provided} />)}</Draggable>
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
