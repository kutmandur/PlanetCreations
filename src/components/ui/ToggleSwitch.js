import React from 'react';

const ToggleSwitch = ({ isToggled, onToggle, labels, disabled = false }) => (
    <div className={`flex items-center space-x-3 ${disabled ? 'cursor-not-allowed' : ''}`}>
        {labels && <span className={`font-semibold text-sm ${!isToggled ? 'text-white' : 'text-gray-400'}`}>{labels.off}</span>}
        <div onClick={!disabled ? onToggle : undefined} className={`relative w-14 h-8 flex items-center rounded-full p-1 transition-colors duration-300 ${disabled ? 'bg-gray-800' : isToggled ? 'bg-green-500' : 'bg-gray-600'} ${disabled ? '' : 'cursor-pointer'}`}>
            <div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${isToggled ? 'translate-x-6' : 'translate-x-0'}`}></div>
        </div>
        {labels && <span className={`font-semibold text-sm ${isToggled ? 'text-white' : 'text-gray-400'}`}>{labels.on}</span>}
    </div>
);

export default ToggleSwitch;