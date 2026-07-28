import React from 'react';
import { getGameColor } from '../../utils/helpers';

const RollerCoasterSpinner = ({ gameId = 'default', size = 'large' }) => {
    const color = getGameColor(gameId);

    // Configuration for different spinner sizes
    const sizeConfig = {
        small: {
            container: 'w-8 h-8', // 32px
            trackWidth: '2px',
            cart: { width: 8, height: 6, rotation: '90deg' },
            radius: '14px' // (32px / 2) - border width
        },
        large: {
            container: 'w-16 h-16', // 64px
            trackWidth: '3px',
            cart: { width: 14, height: 10, rotation: '90deg' },
            radius: '29px' // (64px / 2) - border width
        },
    };

    const currentSize = sizeConfig[size] || sizeConfig.large;
    const cart = currentSize.cart;

    return (
        <div className="flex justify-center items-center p-10" style={color.style}>
            <div className={`relative flex justify-center items-center ${currentSize.container}`}>
                {/* 1. The Stationary Track */}
                <div 
                    className={`absolute w-full h-full ${color.border} border-dashed rounded-full`}
                    style={{ borderWidth: currentSize.trackWidth }}
                ></div>
                
                {/* 2. The Moving Cart */}
                {/* This container establishes the center point for the animation */}
                <div 
                    className="absolute w-full h-full animate-coaster-spin"
                    style={{ '--coaster-radius': currentSize.radius }}
                >
                    {/* The SVG is the visual cart. It's positioned at the edge of the spinning container */}
                    <svg
                        width={cart.width}
                        height={cart.height}
                        viewBox="0 0 14 10"
                        className={`${color.text}`} // Use text color to control the SVG fill
                        style={{ transform: `rotate(${cart.rotation})` }} // Orients the cart to "face forward"
                    >
                        <path 
                            d="M0 8 L0 2 Q 0 0, 2 0 L12 0 Q 14 0, 14 2 L14 8 Z" 
                            fill="currentColor" 
                        />
                    </svg>
                </div>
            </div>
        </div>
    );
};

export default RollerCoasterSpinner;