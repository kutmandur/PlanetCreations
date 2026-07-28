import React from 'react';

const EventSubmissionRules = ({
    allowMultipleSubmissions, setAllowMultipleSubmissions,
    submissionLimit, setSubmissionLimit,
    blockOldCreations, setBlockOldCreations,
    creationCutoffDate, setCreationCutoffDate,
    voteType, setVoteType,
    voteLimit, setVoteLimit,
    votingEnabled, setVotingEnabled
}) => {
    return (
        <div>
            <label className="block text-gray-700 font-bold mb-2">Submission & Voting Rules</label>
            <div className="space-y-4 bg-gray-100 p-4 rounded-lg">
                <div className="flex items-center justify-between"><span className="text-gray-600">Allow multiple submissions per user?</span><div className="relative w-14 h-8 flex items-center rounded-full cursor-pointer p-1" onClick={() => setAllowMultipleSubmissions(!allowMultipleSubmissions)} style={{ backgroundColor: allowMultipleSubmissions ? '#34D399' : '#D1D5DB' }}><div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${allowMultipleSubmissions ? 'translate-x-6' : 'translate-x-0'}`}></div></div></div>
                {allowMultipleSubmissions && (<div className="pl-6"><label className="block text-sm font-semibold text-gray-600 mb-1">Max submissions per user:</label><input type="number" value={submissionLimit} onChange={(e) => setSubmissionLimit(e.target.value)} min="2" className="w-full p-2 border rounded-lg" /></div>)}
                <div className="flex items-center justify-between pt-4 border-t"><span className="text-gray-600">Block creations made before a specific date?</span><div className="relative w-14 h-8 flex items-center rounded-full cursor-pointer p-1" onClick={() => setBlockOldCreations(!blockOldCreations)} style={{ backgroundColor: blockOldCreations ? '#34D399' : '#D1D5DB' }}><div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${blockOldCreations ? 'translate-x-6' : 'translate-x-0'}`}></div></div></div>
                {blockOldCreations && (<div className="pl-6"><label className="block text-sm font-semibold text-gray-600 mb-1">Creations must be made after:</label><input type="date" value={creationCutoffDate} onChange={(e) => setCreationCutoffDate(e.target.value)} className="w-full p-2 border rounded-lg" /></div>)}
                <div className="flex items-center justify-between pt-4 border-t"><span className="text-gray-600">Enable voting for this event?</span><div className="relative w-14 h-8 flex items-center rounded-full cursor-pointer p-1" onClick={() => setVotingEnabled(!votingEnabled)} style={{ backgroundColor: votingEnabled ? '#34D399' : '#D1D5DB' }}><div className={`absolute bg-white w-6 h-6 rounded-full shadow-md transform transition-transform duration-300 ${votingEnabled ? 'translate-x-6' : 'translate-x-0'}`}></div></div></div>
                {votingEnabled && (<>
                <div className="flex items-center justify-between pt-4 border-t"><span className="text-gray-600">Voting Rule:</span><div className="flex items-center space-x-2"><button type="button" onClick={() => setVoteType('multiple')} className={`px-3 py-1 text-sm rounded-full font-semibold ${voteType === 'multiple' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'}`}>Vote for Multiple</button><button type="button" onClick={() => setVoteType('single')} className={`px-3 py-1 text-sm rounded-full font-semibold ${voteType === 'single' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'}`}>Vote for One</button></div></div>
                {voteType === 'multiple' && (<div className="pl-6"><label className="block text-sm font-semibold text-gray-600 mb-1">Max votes per user:</label><input type="number" value={voteLimit} onChange={(e) => setVoteLimit(e.target.value)} min="1" className="w-full p-2 border rounded-lg" /></div>)}
                </>)}
            </div>
        </div>
    );
};

export default EventSubmissionRules;