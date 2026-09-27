import React, {useEffect, useState} from 'react';
import {useNavigate} from 'react-router-dom';
import {collection, query, orderBy, limit, where, onSnapshot, doc, getDoc} from 'firebase/firestore';
import {getFunctions, httpsCallable} from 'firebase/functions';
import {db} from '../../firebase/config';
import ReportReviewControls, {ModerationButton} from '../ui/ReportReviewControls';

import ModerationIndexPanel from './ModerationIndexPanel';
import PillTabs from '../ui/PillTabs';

const date=value=>value?.toDate?.().toLocaleString()||'Not recorded';
function ReviewDetails({target}){
    const navigate=useNavigate();
    const [reviews,setReviews]=useState([]),[count,setCount]=useState(50),[loading,setLoading]=useState(true);
    const [names,setNames]=useState({}),[draft,setDraft]=useState(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
    useEffect(()=>onSnapshot(query(collection(db,'contentReviews'),...(target?[where('targetType','==',target.type),where('targetId','==',target.id)]:[orderBy('updatedAt','desc')]),limit(count)),snap=>{setReviews(snap.docs.map(item=>({id:item.id,...item.data()})));setLoading(false);},()=>{setLoading(false);setMessage('Review history could not be loaded.');}),[count,target]);
    useEffect(()=>{
        let active=true;
        const ids=[...new Set(reviews.flatMap(review=>[review.reviewedBy,review.amendedBy,...(review.history||[]).map(entry=>entry.actorUid)]).filter(Boolean))];
        Promise.all(ids.map(async uid=>{try{const snap=await getDoc(doc(db,'profiles',uid));return [uid,snap.exists()?(snap.data().username||uid):'Deleted user'];}catch{return [uid,'Name unavailable'];}})).then(entries=>{if(active)setNames(Object.fromEntries(entries));});
        return ()=>{active=false;};
    },[reviews]);
    const person=(uid,deleted)=>deleted?'Deleted user':uid?(names[uid]||'Loading…'):'Not recorded (legacy review)';
    const save=async event=>{
        event.preventDefault();if(!draft?.reason.trim()||busy)return;
        setBusy(true);setMessage('');
        try{
            if(draft.mode==='amend')await httpsCallable(getFunctions(),'amendContentReview')({caseId:draft.id,reason:draft.reason,expectedRevision:draft.revision});
            else await httpsCallable(getFunctions(),'reviewContentReport')({reportId:draft.id,action:'reopen',reason:draft.reason,expectedRevision:draft.revision});
            setDraft(null);setMessage('Review updated. The change is recorded in the history.');
        }catch(error){setMessage(error.message);}finally{setBusy(false);}
    };
    return <section className="space-y-4">
        <h2 className="text-2xl font-bold">Review History</h2>
        <p className="text-sm text-gray-600">Review decisions, reasons and staff attribution, with the latest 100 history entries per case. Corrections are recorded as new entries. Original evidence and review text follow the existing 30-day retention period; already expired history cannot be recovered.</p>
        {message&&<p role="status">{message}</p>}
        {loading&&<p>Loading reviews…</p>}
        {!loading&&!reviews.length&&<p>No retained reviews found.</p>}
        {reviews.map(review=><article key={review.id} className="rounded-lg border bg-white shadow-sm">
            <div className="p-4 space-y-2">
                <h3 className="font-semibold">{review.targetType}: {review.targetId}</h3>
                <p>Status: {review.status} · Updated: {date(review.updatedAt)}</p>
                <p>Reviewed by: {person(review.reviewedBy,review.reviewedByDeleted)}</p>
                {(review.amendedBy||review.amendedByDeleted)&&<p>Reason last corrected by: {person(review.amendedBy,review.amendedByDeleted)}</p>}
                <p className="whitespace-pre-wrap break-words">Reason: {review.reason||'No retained reason'}</p>
                {review.targetPath?.startsWith('/')&&!review.targetPath.startsWith('//')&&<ModerationButton label="View content" description="Open the content associated with this review." onClick={()=>navigate(review.targetPath)}/>}
                <details><summary className="cursor-pointer">Decision and correction history ({review.history?.length||0})</summary>
                    <ol className="mt-2 space-y-3">{(review.history||[]).map((entry,index)=><li key={index} className="border-l-2 pl-3 text-sm">
                        <p>{date(entry.at)} · {entry.action} · {person(entry.actorUid,entry.actorDeleted)}</p>
                        {entry.previousReason!==undefined&&<p className="whitespace-pre-wrap break-words">Previous reason: {entry.previousReason}</p>}
                        <p className="whitespace-pre-wrap break-words">{entry.reason}</p>
                    </li>)}</ol>
                </details>
                {draft?.id===review.id?<form onSubmit={save} className="space-y-2">
                    <label className="block">{draft.mode==='amend'?'Corrected review reason':'Reason for reopening'}<textarea required maxLength={1000} disabled={busy} value={draft.reason} onChange={e=>setDraft({...draft,reason:e.target.value})} className="block w-full border rounded p-2"/></label>
                    <p className="text-xs">A correction updates the author’s existing notice. Reopening keeps the current content and visibility unchanged until another decision is made.</p>
                    <div className="flex flex-wrap justify-end gap-2"><ModerationButton type="submit" label="Save review change" color="green" description="Save this change and add it to the review history." disabled={busy||!draft.reason.trim()}/>
                    <ModerationButton label="Cancel" color="gray" description="Discard the unsaved change." disabled={busy} onClick={()=>setDraft(null)}/></div>
                </form>:<div className="flex justify-end flex-wrap gap-2">
                    <ModerationButton label="Edit reason" color="yellow" description="Correct the current reason. The previous reason and your identity remain in the history; visibility and retention are unchanged." disabled={busy||review.evidenceExpired||review.expiresAt?.toDate?.().getTime()<=Date.now()} onClick={()=>setDraft({id:review.id,revision:review.revision||0,mode:'amend',reason:review.reason||''})}/>
                    {['restore','dismiss','publish'].includes(review.status)&&<ModerationButton label="Reopen review" description="Reopen this completed case for a new decision without automatically hiding or restoring its content." disabled={busy} onClick={()=>setDraft({id:review.id,revision:review.revision||0,mode:'reopen',reason:''})}/>}
                </div>}
            </div>
            <details><summary className="px-4 pb-3 cursor-pointer">Review actions</summary><ReportReviewControls reports={[{id:review.id,status:review.status,reason:review.reportReason,targetType:review.targetType,targetId:review.targetId,category:review.category,mediaKey:review.mediaKey,mediaType:review.mediaType}]}/></details>
        </article>)}
        {reviews.length>=count&&<ModerationButton label="Load older reviews" description="Load the next 50 retained review records." onClick={()=>setCount(count+50)}/>}
    </section>;
}

export default function ReviewHistoryManager(){
    const [category,setCategory]=useState('Creations'),[selected,setSelected]=useState(null),[history,setHistory]=useState(false);
    return <section className="space-y-4">
        <div className="flex flex-wrap justify-end gap-2">
            <ModerationButton label="Completed cases" description="Browse the compact archive without loading review details." onClick={()=>{setSelected(null);setHistory(false);}}/>
            <ModerationButton label="All review history" description="Load retained review records, including reviews of active cases." onClick={()=>{setSelected(null);setHistory(true);}}/>
        </div>
        {selected||history?<ReviewDetails key={selected?.key||'history'} target={selected}/>:<>
            <h2 className="text-2xl font-bold">Completed cases</h2>
            <PillTabs tabs={['Creations','Users','Content']} value={category} onChange={setCategory} ariaLabel="Archived report categories"/>
            <ModerationIndexPanel key={category} category={category} archive onOpenCase={setSelected}/>
        </>}
    </section>;
}
