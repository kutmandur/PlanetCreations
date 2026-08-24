import React, { useEffect, useRef, useState } from 'react';

const AnimatedPillTabs = ({ activeTab, onChange, tabs }) => {
    const buttonRefs = useRef([]);
    const containerRef = useRef(null);
    const [gliderStyle, setGliderStyle] = useState({ opacity: 0 });

    useEffect(() => {
        const updateGlider = () => {
            const activeIndex = tabs.findIndex(tab => tab.id === activeTab);
            const activeButton = buttonRefs.current[activeIndex];
            if (!activeButton) return;
            setGliderStyle({
                opacity: 1,
                transform: `translateX(${activeButton.offsetLeft}px)`,
                width: `${activeButton.offsetWidth}px`,
            });
        };
        updateGlider();
        const observer = typeof ResizeObserver === 'function' && containerRef.current ?
            new ResizeObserver(updateGlider) : null;
        if (observer && containerRef.current) observer.observe(containerRef.current);
        window.addEventListener('resize', updateGlider);
        return () => {
            observer?.disconnect();
            window.removeEventListener('resize', updateGlider);
        };
    }, [activeTab, tabs]);

    return (
        <div ref={containerRef} className="relative mx-auto flex w-full max-w-xs items-center rounded-full bg-gray-200 p-1 shadow-inner dark:bg-gray-800">
            <div className="absolute bottom-1 left-0 top-1 rounded-full bg-blue-600 shadow transition-all duration-300 ease-out" style={gliderStyle} />
            {tabs.map((tab, index) => (
                <button
                    key={tab.id}
                    ref={element => { buttonRefs.current[index] = element; }}
                    type="button"
                    onClick={() => onChange(tab.id)}
                    className={`relative z-10 flex-1 rounded-full px-4 py-2 text-sm font-bold transition-colors duration-300 ${activeTab === tab.id ? 'text-white' : 'text-gray-600 hover:text-gray-950 dark:text-gray-300 dark:hover:text-white'}`}
                >
                    {tab.label}
                </button>
            ))}
        </div>
    );
};

export default AnimatedPillTabs;
