import React from 'react';
import Icon from '../ui/Icon';
import { ICONS } from '../../utils/helpers';

const RickRollModal = ({ onClose }) => {
    return (
        <div className="fixed inset-0 bg-black/75 flex justify-center items-center z-50 p-4">
            <div className="bg-white p-6 rounded-lg shadow-xl text-center max-w-lg w-full">
                <div className="flex justify-between items-center mb-4">
                    <h3 className="text-2xl font-bold text-red-600">Access Denied!</h3>
                    <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
                        <Icon path={ICONS.xMark} className="w-6 h-6" />
                    </button>
                </div>
                <p className="mb-4 text-gray-700">Nice try, but you have no power here!</p>
                <div className="aspect-video">
                    <iframe 
                        width="100%" 
                        height="100%" 
                        src="https://www.youtube.com/embed/dQw4w9WgXcQ?autoplay=1" 
                        title="YouTube video player" 
                        frameBorder="0" 
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" 
                        allowFullScreen
                    ></iframe>
                </div>
                <button 
                    onClick={onClose} 
                    className="mt-6 w-full bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-lg"
                >
                    I understand...
                </button>
            </div>
        </div>
    );
};

export default RickRollModal;
