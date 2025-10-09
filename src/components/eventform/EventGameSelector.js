import React from 'react';

const EventGameSelector = ({ game, setGame, TABS, tabRefs, gliderRef, color }) => {
    return (
        <div className="flex justify-center my-6">
            <div className="relative flex items-center bg-gray-200 rounded-full p-1 shadow-inner">
                <div ref={gliderRef} className={`absolute h-full rounded-full ${color.bg} transition-all duration-500 ease-in-out`} />
                {TABS.map((tab, index) => (
                    <button
                        key={tab.id}
                        type="button"
                        ref={el => tabRefs.current[index] = el}
                        onClick={() => setGame(tab.id)}
                        className={`relative z-10 py-2 px-6 rounded-full transition-colors duration-300 font-medium ${game === tab.id ? 'text-white' : 'text-gray-600 hover:text-black'}`}
                    >
                        {tab.name}
                    </button>
                ))}
            </div>
        </div>
    );
};

export default EventGameSelector;