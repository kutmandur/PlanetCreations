import React, {useState} from 'react';
import ReportModal from './ReportModal';
import {submitContentReport} from '../../firebase/contentReporting';
import {ModerationButton} from './ReportReviewControls';
export default function ContentReportButton({target, label='Report content'}) {
    const [open,setOpen]=useState(false),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
    return <span className="inline-flex flex-col gap-1">
        <ModerationButton label={label} color="red" description="Report this content to the moderation team. Choose a category and provide a reason." disabled={busy} onClick={()=>setOpen(true)}/>
        {message && <span role="status" className="text-sm">{message}</span>}
        {open && <ReportModal targetType={target.targetType} targetId={target.targetId} initialMediaUrl={target.mediaUrl} initialCategory={target.mediaType==='video'?'other':target.mediaUrl?'images':'other'} initialMediaType={target.mediaType} onCancel={()=>setOpen(false)} onConfirm={async (reason,category,mediaUrl)=>{
            setBusy(true);
            try {const {mediaUrl:previousMedia,...baseTarget}=target;const result=await submitContentReport({...baseTarget,...(mediaUrl?{mediaUrl}:{})},reason,category);setMessage(result.duplicate?'You have already reported this content.':'Report received for moderation.');}
            catch(error){throw error;}finally{setBusy(false);}
            setOpen(false);
        }}/>}
    </span>;
}
