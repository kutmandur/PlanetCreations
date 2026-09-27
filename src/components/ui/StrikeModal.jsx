import React, { useState } from 'react';
import {ModerationButton} from './ReportReviewControls';

const StrikeModal = ({ onConfirm, onCancel }) => {
    const [reason, setReason] = useState('');
    const [busy,setBusy]=useState(false),[error,setError]=useState('');

    const handleConfirm = async () => {
        if(!reason.trim()||busy)return;
        setBusy(true);setError('');
        try{await onConfirm(reason);}catch(error){setError(error.message||'The warning could not be saved.');}finally{setBusy(false);}
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
            <div className="bg-white p-8 rounded-lg shadow-xl max-w-md w-full">
                <h3 className="text-xl font-bold mb-4">Issue a Strike</h3>
                <p className="text-gray-600 mb-4">Please provide a reason for this strike. The user will be notified.</p>
                <div>
                    <label htmlFor="strike-reason" className="block text-sm font-medium text-gray-700 mb-1">Reason for Strike</label>
                    <textarea
                        id="strike-reason"
                        maxLength={1000}
                        disabled={busy}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                        rows="4"
                        className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-yellow-500 focus:border-yellow-500"
                        placeholder="e.g., Violation of community guidelines regarding spam."
                    />
                </div>
                <div className="flex flex-wrap justify-end gap-2 mt-6 p-3 bg-gray-50 border-t">
                    <ModerationButton label="Cancel" color="gray" description="Close without issuing a strike." disabled={busy} onClick={onCancel}/>
                    <ModerationButton label="Issue Strike" color="yellow" description="Warn the author and record the reason. A strike does not resolve the content report." onClick={handleConfirm} disabled={busy||!reason.trim()}/>
                </div>
                {error&&<p role="alert">{error}</p>}
            </div>
        </div>
    );
};

export default StrikeModal;
