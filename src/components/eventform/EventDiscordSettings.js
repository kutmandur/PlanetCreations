import React from 'react';

// Interne Sub-Komponente für die Erinnerungs-Eingabefelder
const ReminderInput = ({ index, reminder, onchange, isVoteReminder = false }) => (
    <div className="p-2 border rounded-lg bg-white">
        <label className="text-sm font-semibold text-gray-700 mb-2 block">Reminder {index + 1}:</label>
        <div className="grid grid-cols-3 items-center gap-2">
            <input 
                type="number" 
                min="0" 
                value={reminder.days} 
                onChange={(e) => onchange(index, 'days', e.target.value, isVoteReminder)} 
                className="p-2 border rounded-lg w-full" 
            />
            <input 
                type="number" 
                min="0" max="23"
                value={reminder.hours} 
                onChange={(e) => onchange(index, 'hours', e.target.value, isVoteReminder)} 
                className="p-2 border rounded-lg w-full" 
            />
            <input 
                type="number" 
                min="0" max="59"
                value={reminder.minutes} 
                onChange={(e) => onchange(index, 'minutes', e.target.value, isVoteReminder)} 
                className="p-2 border rounded-lg w-full" 
            />
            <label className="text-xs text-center text-gray-500">Days</label>
            <label className="text-xs text-center text-gray-500">Hours</label>
            <label className="text-xs text-center text-gray-500">Minutes</label>
        </div>
    </div>
);

// Interne Sub-Komponente für die Textfelder der Benachrichtigungsvorlagen
const NotificationTemplateInput = ({ templateKey, templates, setTemplates, getSuggestions }) => {
    const suggestions = getSuggestions(templateKey);
    return (
        <div>
            <label className="block text-sm font-semibold text-gray-600 mb-1 capitalize">{templateKey.replace(/([A-Z])/g, ' $1')}</label>
            <div className="relative">
                <textarea 
                    value={templates[templateKey]} 
                    onChange={(e) => setTemplates(p => ({ ...p, [templateKey]: e.target.value }))} 
                    className="w-full p-2 border rounded-lg" 
                    rows="3" 
                />
                {suggestions.length > 0 && (
                    <select 
                        className="absolute top-1 right-1 bg-gray-200 rounded text-xs p-1 appearance-none cursor-pointer" 
                        onChange={(e) => { 
                            if (e.target.value) { 
                                setTemplates(p => ({ ...p, [templateKey]: e.target.value})); 
                                e.target.value = ''; 
                            }
                        }}
                    >
                        <option value="">Use previous...</option>
                        {suggestions.map((msg, i) => (<option key={i} value={msg}>{msg.substring(0, 30)}...</option>))}
                    </select>
                )}
            </div>
        </div>
    );
};


const EventDiscordSettings = ({
    reminders, 
    voteReminders, 
    handleReminderChange, 
    separateVoteTime,
    notificationTemplates, 
    setNotificationTemplates, 
    getMessageSuggestions
}) => {
    return (
        <>
            <div>
                <label className="block text-gray-700 font-bold mb-2">Discord Reminders</label>
                <div className="p-4 border rounded-lg bg-gray-50 space-y-3">
                    <p className="text-sm text-gray-600">Set up to 3 automated reminders before the submission period ends.</p>
                    {[0, 1, 2].map(index => 
                        <ReminderInput 
                            key={`sub-${index}`} 
                            index={index} 
                            reminder={reminders[index]} 
                            onchange={handleReminderChange} 
                        />
                    )}
                </div>
            </div>

            {separateVoteTime && (
                <div>
                    <label className="block text-gray-700 font-bold mb-2">Discord Voting Reminders</label>
                    <div className="p-4 border rounded-lg bg-gray-50 space-y-3">
                        <p className="text-sm text-gray-600">Set reminders for the voting period.</p>
                        {[0, 1, 2].map(index => 
                            <ReminderInput 
                                key={`vote-${index}`} 
                                index={index} 
                                reminder={voteReminders[index]} 
                                onchange={handleReminderChange} 
                                isVoteReminder 
                            />
                        )}
                    </div>
                </div>
            )}
            
            <div>
                <h3 className="text-xl font-bold text-gray-800 border-b pb-2 mb-4">Custom Notifications</h3>
                <p className="text-sm text-gray-500 mb-2">
                    Optionally override default messages. Placeholders: <code className="text-xs bg-gray-200 p-1 rounded">{'{eventName}'}</code>, <code className="text-xs bg-gray-200 p-1 rounded">{'{eventLink}'}</code>, <code className="text-xs bg-gray-200 p-1 rounded">{'{timeRemaining}'}</code>
                </p>
                <div className="space-y-4 p-4 border rounded-lg bg-gray-50">
                    {Object.keys(notificationTemplates).map(key => (
                        <NotificationTemplateInput 
                            key={key} 
                            templateKey={key} 
                            templates={notificationTemplates} 
                            setTemplates={setNotificationTemplates} 
                            getSuggestions={getMessageSuggestions} 
                        />
                    ))}
                </div>
            </div>
        </>
    );
};

export default EventDiscordSettings;