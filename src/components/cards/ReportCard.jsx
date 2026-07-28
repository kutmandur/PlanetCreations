import React, { useState } from 'react';
import { ICONS } from '../../utils/helpers';
import Icon from '../ui/Icon';

const ReportCard = ({ item, onAction, setPopoverView }) => {
    const [isPopoverVisible, setIsPopoverVisible] = useState(false);
    const isCreation = item.type === 'creation';
    const firstReportDate = item.reports[0]?.timestamp ? new Date(item.reports[0].timestamp.seconds * 1000).toLocaleDateString() : 'N/A';

    const handleTitleClick = () => {
        if (isCreation) {
            setPopoverView({ name: 'detail', id: item.id });
        } else {
            // Assuming the item.id for a user report is the userId
            setPopoverView({ name: 'profile', userId: item.id });
        }
    };

    return (
        <article className="bg-white rounded-lg shadow-md border border-gray-200 flex flex-col">
            <div className="p-4 flex-grow">
                <div className="flex justify-between items-start">
                    <div>
                        <span className={`text-xs font-bold uppercase px-2 py-1 rounded-full ${isCreation ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>
                            {item.type}
                        </span>
                        <button onClick={handleTitleClick} className="text-left w-full">
                            <h3 className="text-lg font-bold mt-2 truncate hover:underline">{item.title || item.username || 'N/A'}</h3>
                        </button>
                        <p className="text-sm text-gray-500 truncate">{item.id}</p>
                    </div>
                    <div className="relative">
                        <button 
                            onMouseEnter={() => setIsPopoverVisible(true)}
                            onMouseLeave={() => setIsPopoverVisible(false)}
                            className="flex items-center text-gray-500 hover:text-blue-600"
                        >
                            {item.reports.length} <Icon path={ICONS.flag} className="w-5 h-5 ml-1" solid />
                        </button>
                        {isPopoverVisible && (
                            <div className="absolute right-0 mt-2 w-64 bg-white rounded-lg shadow-xl p-4 z-20 border">
                                <h4 className="font-bold mb-2">Report Reasons:</h4>
                                <ul className="list-disc list-inside text-sm text-gray-700 max-h-48 overflow-y-auto">
                                    {item.reports.map((report, index) => (
                                        <li key={index} className="mb-1">{report.reason}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
                <p className="text-xs text-gray-500 mt-4">First reported on: {firstReportDate}</p>
            </div>
            <div className="p-4 bg-gray-50 border-t flex justify-end space-x-2">
                <button onClick={() => onAction('strike', item.id, item.type)} className="text-sm font-semibold bg-yellow-500 hover:bg-yellow-600 text-white py-1 px-3 rounded-md">Strike</button>
                <button onClick={() => onAction(isCreation ? 'delete' : 'ban', item.id, item.type)} className="text-sm font-semibold bg-red-500 hover:bg-red-600 text-white py-1 px-3 rounded-md">
                    {isCreation ? 'Delete' : 'Ban'}
                </button>
                <button onClick={() => onAction('resolve', item.id, item.type)} className="text-sm font-semibold bg-green-500 hover:bg-green-600 text-white py-1 px-3 rounded-md">Resolve</button>
            </div>
        </article>
    );
};

export default ReportCard;
