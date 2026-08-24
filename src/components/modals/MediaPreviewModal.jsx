import React, { useState, useEffect } from 'react';
import Spinner from '../ui/Spinner';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const MEDIA_TYPES = {
    images: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
    videos: ['.mp4', '.webm', '.mov'],
    audio: ['.mp3', '.ogg'],
};

const MediaPreviewModal = ({ file, onClose }) => {
    const [mediaSrc, setMediaSrc] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        if (file && window.electronAPI) {
            setLoading(true);
            setError(null);
            setMediaSrc(null);

            const fetchMedia = async () => {
                try {
                    const dataUrl = await window.electronAPI.readFileAsDataURL(file.path);
                    if (dataUrl) {
                        setMediaSrc(dataUrl);
                    } else {
                        setError('Could not load media file.');
                    }
                } catch (e) {
                    console.error('Error fetching media as data URL:', e);
                    setError(`Error: ${e.message}`);
                } finally {
                    setLoading(false);
                }
            };

            fetchMedia();
        }
    }, [file]);

    if (!file) return null;

    let content;
    if (loading) {
        content = <Spinner />;
    } else if (error) {
        content = <p className="text-red-400">{error}</p>;
    } else if (mediaSrc) {
        const fileExtension = file.path.split('.').pop().toLowerCase();
        if (MEDIA_TYPES.images.some(ext => `.${fileExtension}` === ext)) {
            content = <img src={mediaSrc} alt={file.name} className="max-w-full max-h-[80vh] object-contain" />;
        } else if (MEDIA_TYPES.videos.some(ext => `.${fileExtension}` === ext)) {
            content = <video src={mediaSrc} controls autoPlay className="max-w-full max-h-[80vh]"></video>;
        } else if (MEDIA_TYPES.audio.some(ext => `.${fileExtension}` === ext)) {
            content = <audio src={mediaSrc} controls autoPlay></audio>;
        } else {
            content = <p className="text-white">Cannot preview this file type.</p>;
        }
    } else {
        content = <p className="text-white">No media to display.</p>;
    }

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60]" onClick={onClose}>
            <div className="bg-gray-800 p-4 rounded-lg relative shadow-2xl min-w-[300px] min-h-[200px] flex flex-col" onClick={e => e.stopPropagation()}>
                <button onClick={onClose} className="absolute -top-3 -right-3 bg-red-600 hover:bg-red-700 rounded-full p-1 text-white z-10">
                     <Icon path={ICONS.xMark} className="w-5 h-5" />
                </button>
                <h4 className="text-white mb-2 font-semibold truncate max-w-lg">{file.name}</h4>
                <div className="flex-grow flex items-center justify-center">
                    {content}
                </div>
            </div>
        </div>
    );
};

export default MediaPreviewModal;
