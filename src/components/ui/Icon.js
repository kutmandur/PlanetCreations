import React from 'react';

const Icon = ({ path, className = "w-6 h-6", solid = false, strokeWidth = 1.5 }) => (
    <svg 
        xmlns="http://www.w3.org/2000/svg" 
        viewBox="0 0 24 24" 
        fill={solid ? "currentColor" : "none"} 
        stroke="currentColor" 
        strokeWidth={solid ? 0 : strokeWidth} 
        className={className}
    >
        <path 
            fillRule="evenodd" 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            d={path}
            clipRule="evenodd" 
        />
    </svg>
);

export default Icon;