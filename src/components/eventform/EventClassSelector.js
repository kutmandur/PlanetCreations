import React from 'react';

const EventClassSelector = ({ eventClasses, classInput, setClassInput, suggestedClasses, handleAddClass, handleRemoveClass, handleClassKeyDown, color }) => {
    return (
        <div>
            <label className="block text-gray-700 font-bold mb-2">Notification Classes (Max 3)</label>
            <p className="text-sm text-gray-500 mb-2">This is used for Discord syncronization.</p>
            <div className={`w-full p-3 border rounded-lg focus-within:ring-2 ${color.ring}`}>
                <div className="flex flex-wrap gap-2 mb-2">
                    {eventClasses.map(c => (
                        <div key={c} className="flex items-center bg-gray-200 text-gray-800 text-sm font-medium px-2.5 py-1 rounded-full">
                            <span>{c}</span>
                            <button type="button" onClick={() => handleRemoveClass(c)} className="ml-2 text-gray-500 hover:text-gray-800">&times;</button>
                        </div>
                    ))}
                </div>
                <input
                    type="text"
                    value={classInput}
                    onChange={(e) => setClassInput(e.target.value)}
                    onKeyDown={handleClassKeyDown}
                    className="w-full bg-transparent focus:outline-none"
                    placeholder={eventClasses.length < 3 ? "Add a class..." : "Maximum of 3 classes reached"}
                    disabled={eventClasses.length >= 3}
                />
                {suggestedClasses.length > 0 && (
                    <div className="mt-2 pt-2 border-t flex flex-wrap gap-2">
                        {suggestedClasses.map(c => (
                            <button key={c} type="button" onClick={() => handleAddClass(c)} className={`text-sm ${color.bg} ${color.hoverBg} text-white px-2.5 py-1 rounded-full transition-colors`}>
                                {c}
                            </button>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default EventClassSelector;