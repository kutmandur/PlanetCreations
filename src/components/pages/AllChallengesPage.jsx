import React from 'react';

const AllEventsPage = ({ setView }) => {
    return (
        <div className="text-center text-gray-500 mt-10 py-10 bg-white rounded-lg shadow-md">
            <h2 className="text-3xl font-bold text-gray-800">All Events</h2>
            <p className="mt-4 max-w-2xl mx-auto">
                This is where a global list of all active, upcoming, and past events from across all communities will be displayed. Stay tuned!
            </p>
        </div>
    );
};

export default AllEventsPage;