import React from 'react';

const EventTimeSettings = ({
    startDate, setStartDate,
    endDatePart, setEndDatePart,
    endTimePart, setEndTimePart,
    separateVoteTime, setSeparateVoteTime,
    voteStartDate, setVoteStartDate,
    voteEndDatePart, setVoteEndDatePart,
    voteEndTimePart, setVoteEndTimePart,
    handleEndTimeChange,
    timezone, setTimezone, timezones
}) => {
    return (
        <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <label className="block text-gray-700 font-bold mb-2">Submission Start Date & Time</label>
                    <input type="datetime-local" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full p-3 border rounded-lg" required />
                </div>
                <div>
                    <label className="block text-gray-700 font-bold mb-2">Submission End Date & Time</label>
                    <div className="flex gap-2">
                        <input type="date" value={endDatePart} onChange={(e) => setEndDatePart(e.target.value)} className="w-2/3 p-3 border rounded-lg" required />
                        <input type="time" value={endTimePart} onChange={(e) => handleEndTimeChange(e, setEndTimePart)} className="w-1/3 p-3 border rounded-lg" required />
                    </div>
                </div>
            </div>
            <div className="flex items-center space-x-4 bg-gray-100 p-3 rounded-lg">
                <span className="text-gray-600">Separate Voting Time?</span>
                <div className="relative w-14 h-8 flex items-center rounded-full cursor-pointer p-1" onClick={() => setSeparateVoteTime(!separateVoteTime)} style={{ backgroundColor: separateVoteTime ? '#34D399' : '#D1D5DB' }}>
                    <div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${separateVoteTime ? 'translate-x-6' : 'translate-x-0'}`}></div>
                </div>
            </div>
            {separateVoteTime && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div>
                        <label className="block text-gray-700 font-bold mb-2">Voting Start Date & Time</label>
                        <input type="datetime-local" value={voteStartDate} onChange={(e) => setVoteStartDate(e.target.value)} className="w-full p-3 border rounded-lg" required min={startDate} />
                    </div>
                    <div>
                        <label className="block text-gray-700 font-bold mb-2">Voting End Date & Time</label>
                        <div className="flex gap-2">
                            <input type="date" value={voteEndDatePart} onChange={(e) => setVoteEndDatePart(e.target.value)} className="w-2/3 p-3 border rounded-lg" required />
                            <input type="time" value={voteEndTimePart} onChange={(e) => handleEndTimeChange(e, setVoteEndTimePart)} className="w-1/3 p-3 border rounded-lg" required />
                        </div>
                    </div>
                </div>
            )}
            <div>
                <label className="block text-gray-700 font-bold mb-2">Timezone</label>
                <p className="text-sm text-gray-500 mb-2">Times are displayed in this timezone. Defaults to your browser's setting.</p>
                <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className="w-full p-3 border rounded-lg bg-white">
                    {timezones.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                </select>
            </div>
        </>
    );
};

export default EventTimeSettings;