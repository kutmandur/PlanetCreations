import React, { useEffect, useRef } from 'react';

const PillTabs = ({
    tabs,
    value,
    onChange,
    counts = {},
    accentClass = 'bg-blue-500',
    ariaLabel,
    className = '',
}) => {
    const tabRefs = useRef([]);
    const gliderRef = useRef(null);

    useEffect(() => {
        const activeIndex = tabs.indexOf(value);
        const activeNode = tabRefs.current[activeIndex];
        if (activeNode && gliderRef.current) {
            gliderRef.current.style.left = `${activeNode.offsetLeft}px`;
            gliderRef.current.style.width = `${activeNode.offsetWidth}px`;
        }
    }, [tabs, value]);

    return (
        <div className={`flex justify-center ${className}`}>
            <div
                role="tablist"
                aria-label={ariaLabel}
                className="relative flex max-w-full items-center overflow-x-auto rounded-full bg-gray-200 p-1 shadow-inner"
            >
                <div
                    ref={gliderRef}
                    aria-hidden="true"
                    className={`absolute inset-y-1 rounded-full transition-all duration-300 ease-in-out ${accentClass}`}
                />
                {tabs.map((tab, index) => (
                    <button
                        key={tab}
                        ref={element => { tabRefs.current[index] = element; }}
                        type="button"
                        role="tab"
                        aria-selected={value === tab}
                        onClick={() => onChange(tab)}
                        className={`relative z-10 whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition-colors duration-300 sm:px-6 sm:text-base ${value === tab ? 'text-white' : 'text-gray-600 hover:text-black'}`}
                    >
                        {tab}
                        {counts[tab] !== undefined && (
                            <span className={`ml-1.5 rounded-full px-1.5 py-0.5 text-xs font-bold ${value === tab ? 'bg-white text-gray-800' : 'bg-gray-300 text-gray-700'}`}>
                                {counts[tab]}
                            </span>
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
};

export default PillTabs;
