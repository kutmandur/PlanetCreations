import React from 'react';
import { getGameColor } from '../../utils/helpers';

const Modal = ({ message, onClose, activeTab }) => {
    const color = getGameColor(activeTab);
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50" style={color.style}>
            <div className="bg-white dark:bg-gray-800 dark:text-gray-100 p-8 rounded-lg shadow-xl text-center max-w-sm">
                <p className="mb-6 text-lg">{message}</p>
                <button onClick={onClose} className={`${color.bg} ${color.hoverBg} text-white font-bold py-2 px-6 rounded-lg w-full`}>
                    OK
                </button>
            </div>
        </div>
    );
};

export default Modal;