import React, {useState, useEffect, useId} from 'react';
import {doc, onSnapshot} from 'firebase/firestore';
import {db} from '../../firebase/config';
import {getFunctions, httpsCallable} from 'firebase/functions';
import ReportedImagePreview from './ReportedImagePreview';

export function ModerationButton({label, description, color='blue', disabled=false, onClick, type='button'}) {
    const id=useId();
    const colors={gray:'bg-gray-500 hover:bg-gray-600',blue:'bg-blue-500 hover:bg-blue-600',yellow:'bg-yellow-500 hover:bg-yellow-600',red:'bg-red-500 hover:bg-red-600',green:'bg-green-500 hover:bg-green-600'};
    return <span className="group relative inline-flex">
        <button type={type} aria-describedby={id} aria-disabled={disabled} onClick={event=>{if(disabled){event.preventDefault();return;}onClick?.();}} className={`text-sm font-semibold ${colors[color]} text-white py-1 px-3 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 aria-disabled:opacity-50 aria-disabled:cursor-not-allowed`}>{label}</button>
        <span id={id} role="tooltip" className="pointer-events-none invisible absolute bottom-full right-0 z-30 mb-2 w-48 rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-white opacity-0 shadow-lg group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">{description}</span>
    </span>;
}

export default function ReportReviewControls({reports, children}) {
    const reasonId=useId();
    const [selected,setSelected]=useState(reports[0]?.id);
    const reportId=reports.some(report=>report.id===selected)?selected:reports[0]?.id;
    const [reason,setReason]=useState(''),[message,setMessage]=useState(''),[busy,setBusy]=useState(false);
    const [record,setRecord]=useState(null);
    const review=record?.id===reportId?record.data:null;
    const loaded=record?.id===reportId;
    const hasOriginal=Boolean(review?.original&&Object.keys(review.original).length);
    const held=hasOriginal||review?.holdActive===true;
    const reportStatus=reports.find(report=>report.id===reportId)?.status;
    const selectedReport=reports.find(report=>report.id===reportId);
    const status=reportStatus==='deleted'?'deleted':review?.status||reportStatus||'open';
    const closed=['restore','dismiss','publish','deleted'].includes(status);
    useEffect(()=>{
        setReason('');setMessage('');setRecord(null);setShowcaseEdit(null);
        if(!reportId)return;
        return onSnapshot(doc(db,'contentReviews',reportId),snap=>setRecord({id:reportId,data:snap.data()||null}),()=>setMessage('The review record could not be loaded.'));
    },[reportId]);
    const run=async (action,extra={})=>{
        if(busy||!reason.trim()||!loaded)return;
        setBusy(true);
        try{await httpsCallable(getFunctions(),'reviewContentReport')({reportId,action,reason,...extra});setShowcaseEdit(null);setMessage('Review saved.');setReason('');}
        catch(error){setMessage(error.message);}
        finally{setBusy(false);}
    };
    const supported=true;
    const [showcaseEdit,setShowcaseEdit]=useState(null);
    const expired=Boolean(review?.expiresAt?.toMillis?.()<=Date.now());
    const disabled=busy||!reason.trim()||!loaded||!supported;
    const hint=busy?' Saving the current decision.':!loaded?' Loading review data.':!reason.trim()?' Enter a review reason first.':'';
    return <>
        <div className="border-t p-4 space-y-2">
            {reports.length>1&&<label className="block text-sm">Report to review<select disabled={busy} value={reportId} onChange={e=>setSelected(e.target.value)} className="block w-full border rounded p-2">{reports.map((report,index)=><option key={report.id} value={report.id}>{index+1}. {report.reason}</option>)}</select></label>}
            <p className="text-sm">Review: {status}</p>
            <p className="text-sm whitespace-pre-wrap break-words">Report reason: {selectedReport?.reason||'Not recorded'}</p>
            {!supported&&<p role="status" className="text-sm">Open this showcase to manage the reported content using its management tools. Review actions are not supported for showcases yet.</p>}
            {closed&&<p className="text-sm">This report is closed. Admins can correct its reason or reopen it in Review History.</p>}
            <p className="text-sm">Report category: {({images:'Images',text:'Text',other:'Other'})[reports.find(report=>report.id===reportId)?.category]||'Unspecified (legacy report)'}</p>
            {selectedReport?.targetType==='creation'&&selectedReport.mediaKey&&<ReportedImagePreview key={reportId} report={selectedReport} review={review}/>}
            {review?.evidenceExpired&&<p className="text-sm">The original content has expired. Edit and approve the current version to release this hold.</p>}
            {review?.appeal&&<p className="text-sm">Author’s appeal: {review.appeal}</p>}
            {showcaseEdit&&<fieldset disabled={busy} className="space-y-2 rounded border p-3"><legend>Showcase details</legend><label className="block">Showcase name<input className="block w-full border rounded p-2" maxLength={80} value={showcaseEdit.name} onChange={e=>setShowcaseEdit({...showcaseEdit,name:e.target.value})}/></label><label className="block">Video URL<input type="url" className="block w-full border rounded p-2" value={showcaseEdit.videoUrl} onChange={e=>setShowcaseEdit({...showcaseEdit,videoUrl:e.target.value})}/></label><p className="text-xs">Leave the URL empty to remove the video. Saving keeps the showcase withheld until approval.</p></fieldset>}
            {hasOriginal&&<details><summary>Retained display content (staff only)</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(review.original,null,2)}</pre></details>}
            {review?.retainedEvidence&&<details><summary>Previous content (staff only)</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(review.retainedEvidence,null,2)}</pre></details>}
            {review?.history?.length>0&&<details><summary>Review history</summary>{review.history.map((entry,index)=><p key={index} className="text-xs">{entry.action}: {entry.reason}</p>)}</details>}
            {!closed&&supported&&<div className="group relative text-sm">
                <label htmlFor={reasonId} className="block w-fit cursor-help">Review reason</label>
                <span id={`${reasonId}-help`} role="tooltip" className="pointer-events-none invisible absolute bottom-full left-0 z-30 mb-2 w-64 max-w-full rounded-lg bg-gray-900 p-3 text-xs leading-relaxed text-white opacity-0 shadow-lg group-hover:visible group-hover:opacity-100 group-focus-within:visible group-focus-within:opacity-100">Briefly explain your moderation decision and what you checked or changed. A reason is required for review actions and is saved in the review history. Decision reasons may also be shown to the author. Maximum 1,000 characters.</span>
                <textarea id={reasonId} aria-describedby={`${reasonId}-help`} disabled={busy} value={reason} onChange={e=>setReason(e.target.value)} maxLength={1000} className="w-full border rounded p-2" />
            </div>}
            {message&&<p role="status">{message}</p>}
        </div>
        <div className="p-4 bg-gray-50 border-t flex flex-wrap justify-end gap-2">
            {supported&&!closed&&status!=='reviewing'&&<ModerationButton label="Start review" description={'Mark this report as under review. Withheld content and appeal rights remain unchanged.'+hint} disabled={disabled} onClick={()=>run('reviewing')}/>}
            {supported&&!held&&!closed&&<ModerationButton label="Withhold" color="red" description={'Temporarily hide reported text or media. Saves, memberships and votes remain unchanged.'+hint} disabled={disabled} onClick={()=>run('withhold')}/>}
            {supported&&hasOriginal&&<ModerationButton label="Restore" color="green" description={'Restore retained content within 30 days and close the report. Newer edits are protected.'+(expired?' The restoration period has expired.':hint)} disabled={disabled||expired} onClick={()=>run('restore')}/>}
            {held&&['creation','showcase'].includes(review?.targetType)&&<ModerationButton label="Approve edits" color="green" description={'Keep the current edited text and remaining media, release this case’s visibility block and close the report. Removed content is not restored; other active cases still block publication.'+hint} disabled={disabled} onClick={()=>run('publish')}/>}
            {supported&&!held&&!closed&&<ModerationButton label="Resolve" color="green" description={'Close this report without removing content. The reason and review history are retained.'+hint} disabled={disabled} onClick={()=>run('dismiss')}/>}
            {children}
            {held&&review?.targetType==='showcase'&&(showcaseEdit?<><ModerationButton label="Save showcase" color="yellow" description={'Save corrected showcase details without releasing the hold.'+hint} disabled={disabled||!showcaseEdit.name.trim()} onClick={()=>run('edit',showcaseEdit)}/><ModerationButton label="Cancel edit" color="gray" description="Discard unsaved showcase changes." disabled={busy} onClick={()=>setShowcaseEdit(null)}/></>:<ModerationButton label="Edit showcase" color="yellow" description="Correct the showcase name or remove or replace its video. The community owner cannot edit a withheld showcase." disabled={busy} onClick={()=>setShowcaseEdit({name:review.showcaseDetails?.name||review.original?.name||'',videoUrl:review.showcaseDetails?.videoUrl||''})}/>)}
        </div>
    </>;
}
