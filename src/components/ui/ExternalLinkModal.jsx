import React from 'react';
import { getGameColor } from '../../utils/helpers';

const ExternalLinkModal = ({ url, onConfirm, onCancel, activeTab }) => {
    const color = getGameColor(activeTab);
    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50" style={color.style}>
            <div className="bg-white p-8 rounded-lg shadow-xl text-center max-w-md">
                <h3 className="text-xl font-bold mb-4">External Link Warning</h3>
                <p className="mb-6 text-gray-700">
                    You are about to navigate to an external website. The creator of this submission is solely responsible for the content of the external link.
                </p>
                <p className="mb-6 text-sm text-gray-500 break-all">URL: {url}</p>
                <div className="flex justify-center space-x-4">
                    <button onClick={onCancel} className="bg-gray-300 hover:bg-gray-400 text-black font-bold py-2 px-6 rounded-lg w-1/2">
                        Cancel
                    </button>
                    <button onClick={onConfirm} className={`${color.bg} ${color.hoverBg} text-white font-bold py-2 px-6 rounded-lg w-1/2`}>
                        Proceed
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ExternalLinkModal;