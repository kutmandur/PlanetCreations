import React from 'react';
import Icon from './Icon';
import { ICONS } from '../../utils/helpers';

const PopoverModal = ({ children, onClose }) => {
    // This stops the click from closing the modal if you click inside the content area
    const handleContentClick = (e) => e.stopPropagation();

    return (
        <div 
            className="fixed inset-0 bg-black/60 flex justify-center items-center z-50 p-4"
            onClick={onClose} // Close when clicking the background
        >
            <div 
                className="bg-gray-100 rounded-xl shadow-2xl w-full max-w-4xl h-full max-h-[90vh] flex flex-col relative"
                onClick={handleContentClick}
            >
                <div className="flex-shrink-0 p-4 border-b bg-white rounded-t-xl">
                    <button 
                        onClick={onClose} 
                        className="float-right text-gray-500 hover:text-gray-800"
                        aria-label="Close popover"
                    >
                        <Icon path={ICONS.xMark || "M6 18L18 6M6 6l12 12"} className="w-8 h-8" />
                    </button>
                </div>
                <div className="flex-grow overflow-y-auto">
                    {children}
                </div>
            </div>
        </div>
    );
};

export default PopoverModal;
