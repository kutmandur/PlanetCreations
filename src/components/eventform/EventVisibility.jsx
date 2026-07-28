import React from 'react';

const EventVisibility = ({ status, setStatus }) => {
    return (
        <div>
            <label className="block text-gray-700 font-bold mb-2">Visibility</label>
            <div className="flex items-center space-x-4 bg-gray-100 p-3 rounded-lg">
                <span className="text-gray-600">Invisible until event starts?</span>
                <div 
                    className="relative w-14 h-8 flex items-center rounded-full cursor-pointer p-1 transition-colors duration-300"
                    onClick={() => setStatus(status === 'visible' ? 'invisible' : 'visible')}
                    style={{ backgroundColor: status === 'invisible' ? '#34D399' : '#D1D5DB' }}
                >
                    <div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${status === 'invisible' ? 'translate-x-6' : 'translate-x-0'}`}></div>
                </div>
            </div>
        </div>
    );
};

export default EventVisibility;