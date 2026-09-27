import ReportReviewControls, {ModerationButton} from '../ui/ReportReviewControls';
import AccountModerationControls from '../ui/AccountModerationControls';
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ICONS } from '../../utils/helpers';
import Icon from '../ui/Icon';
import {buildModerationEditNavigationState} from '../../utils/creationNavigation';

const ReportCard = ({ item, onAction, setPopoverView }) => {
    const [isPopoverVisible, setIsPopoverVisible] = useState(false);
    const navigate = useNavigate();
    const isCreation = item.type === 'creation';
    const isUser = item.type === 'user';
    const isGenericContent = !isCreation && !isUser;
    const firstReportDate = item.reports[0]?.timestamp ? new Date(item.reports[0].timestamp.seconds * 1000).toLocaleDateString() : 'N/A';
    const pending=item.reports.filter(report=>['open','reviewing','appealed'].includes(report.status||'open'));
    const overdue=pending.some(report=>(report.dueAt?.seconds||(report.timestamp?.seconds||Date.now()/1000)+86400)*1000<Date.now());

    const handleTitleClick = () => {
        if (isCreation) {
            setPopoverView({ name: 'detail', id: item.id });
        } else if (isUser) {
            setPopoverView({ name: 'profile', userId: item.id });
        } else if (typeof item.targetPath === 'string' && item.targetPath.startsWith('/') && !item.targetPath.startsWith('//')) {
            navigate(item.targetPath);
        }
    };

    return (
        <article className="pc-theme-card bg-white rounded-lg shadow-md border border-gray-200 flex flex-col">
            <div className="p-4 flex-grow">
                <div className="flex justify-between items-start">
                    <div>
                        <span className={`text-xs font-bold uppercase px-2 py-1 rounded-full ${isCreation ? 'bg-blue-100 text-blue-800' : 'bg-purple-100 text-purple-800'}`}>
                            {item.type}
                        </span>
                        <button onClick={handleTitleClick} disabled={isGenericContent && !item.targetPath} className="text-left w-full disabled:cursor-default">
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
                                        <li key={index} className="mb-1">{({images:'Images',text:'Text',other:'Other'})[report.category]||'Unspecified'}: {report.reason}</li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
                <p className="text-xs text-gray-500 mt-4">First reported on: {firstReportDate}</p>
                {pending.length>0&&<p role="status" className={overdue?'text-red-700 font-semibold':'text-gray-600'}>{overdue?'Overdue — internal 24-hour review target exceeded':'Awaiting review — internal target: within 24 hours'}</p>}
            </div>
            <ReportReviewControls reports={item.reports}>
                {isCreation && !item.reports.every(report=>report.status==='deleted') && <ModerationButton label="Edit" color="yellow" description="Edit the creation’s text, images and videos. Ownership stays unchanged; editing does not automatically close reports." onClick={()=>navigate(`/creation/${item.id}/edit`,{state:buildModerationEditNavigationState(item.id)})}/>}
                {isCreation && <ModerationButton label="Strike" color="yellow" description="Issue a warning to the author. This does not close reports or change withheld content." onClick={()=>onAction('strike',item.id,item.type)}/>}
                {isCreation && <ModerationButton label="Delete" color="red" description="Permanently delete the creation after password confirmation. Restore retained content first; this action cannot be undone." onClick={()=>onAction('delete',item.id,item.type)}/>}
            </ReportReviewControls>
            {isUser&&<AccountModerationControls targetUserId={item.id}/>}
        </article>
    );
};

export default ReportCard;
