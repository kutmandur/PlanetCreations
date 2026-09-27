import React,{useEffect,useState} from 'react';
import {collection,query,where,orderBy,limit,startAfter,onSnapshot} from 'firebase/firestore';
import {db} from '../../firebase/config';
import ReportCard from '../cards/ReportCard';
import {ModerationButton} from '../ui/ReportReviewControls';

function CaseDetails({item,onAction,setPopoverView}) {
 const [reports,setReports]=useState(null),[error,setError]=useState(''),[cursors,setCursors]=useState([]),[last,setLast]=useState(null);
 const cursor=cursors.at(-1);
 useEffect(()=>{setReports(null);setError('');return onSnapshot(query(collection(db,'reports'),where('targetType','==',item.type),where('targetId','==',item.id),...(cursor?[startAfter(cursor)]:[]),limit(50)),snapshot=>{setReports(snapshot.docs.map(doc=>({id:doc.id,...doc.data()})));setLast(snapshot.docs.at(-1));},error=>setError(error.message));},[item.id,item.type,cursor]);
 if(error)return <p role="alert">{error}</p>;
 if(!reports)return <p role="status">Loading reports…</p>;
 if(!reports.length)return <div><p>No reports on this page.</p><ModerationButton label="Previous reports" description="Return to the previous batch of reports." disabled={!cursors.length} onClick={()=>setCursors(value=>value.slice(0,-1))}/></div>;
 return <><ReportCard item={{...item,reports}} onAction={onAction} setPopoverView={setPopoverView}/><div className="flex gap-2 justify-end mt-2"><ModerationButton label="Previous reports" description="Load the previous batch of reports for this case." disabled={!cursors.length} onClick={()=>setCursors(value=>value.slice(0,-1))}/><ModerationButton label="More reports" description="Load the next batch of up to 50 reports for this case." disabled={reports.length<50} onClick={()=>setCursors(value=>[...value,last])}/></div></>;
}

export default function ModerationIndexPanel({category,onAction,setPopoverView,archive=false,onOpenCase}) {
 const [page,setPage]=useState(null),[cursors,setCursors]=useState([]),[last,setLast]=useState(null),[error,setError]=useState(''),[opened,setOpened]=useState(null);
 const cursor=cursors.at(-1);
 useEffect(()=>{setPage(null);setError('');setOpened(null);return onSnapshot(query(collection(db,archive?'moderationArchiveBlocks':'moderationIndexBlocks'),where('category','==',category),orderBy('number'),...(cursor?[startAfter(cursor)]:[]),limit(1)),snapshot=>{setPage(Object.values(snapshot.docs[0]?.data().entries||{}).sort((a,b)=>(a.dueAt||Infinity)-(b.dueAt||Infinity)));setLast(snapshot.docs.at(-1));},error=>setError(error.message));},[category,cursor,archive]);
 if(error)return <p role="alert">{error}</p>;
 if(!page)return <p role="status">Loading moderation index…</p>;
 return <section><p className="text-sm mb-4">Open a case to view report details and review actions.</p>{!page.length&&<p>No cases on this page.</p>}<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">{page.map(item=><div key={item.key}>{opened===item.key?<><div className="flex justify-end mb-2"><ModerationButton label="Close case details" color="gray" description="Close these details and stop their live subscriptions." onClick={()=>setOpened(null)}/></div><CaseDetails item={item} onAction={onAction} setPopoverView={setPopoverView}/></>:<article className="pc-theme-card bg-white rounded-lg shadow-md border border-gray-200 flex flex-col"><div className="p-4 flex-grow"><p className="text-xs uppercase font-bold">{item.type}</p><h3 className="text-lg font-bold">{item.title}</h3><p>{item.reportCount} reports · {item.pendingCount} awaiting review</p><p className="text-sm">{Object.entries(item.statuses||{}).map(([status,count])=>`${({open:'Open',reviewing:'In review',appealed:'Appealed',withhold:'Withheld',restore:'Restored',publish:'Approved',dismiss:'Resolved',deleted:'Deleted'})[status]||status}: ${count}`).join(' · ')}</p><p className="text-sm">First reported: {item.firstReportedAt?new Date(item.firstReportedAt).toLocaleDateString():'Unknown'}</p>{item.dueAt&&<p className={item.dueAt<Date.now()?'text-red-700 font-semibold':'text-gray-600'}>{item.dueAt<Date.now()?'Overdue — internal 24-hour target exceeded':'Awaiting review'}</p>}</div><div className="p-4 bg-gray-50 border-t flex justify-end"><ModerationButton label="Open case" description="Load this case’s reports, reasons and moderation actions." onClick={()=>onOpenCase?onOpenCase(item):setOpened(item.key)}/></div></article>}</div>)}</div><div className="flex justify-end gap-2 my-4"><ModerationButton label="Previous page" description="Load the previous compact index block." disabled={!cursors.length} onClick={()=>setCursors(value=>value.slice(0,-1))}/><ModerationButton label="Next page" description="Load the next compact index block." disabled={!last} onClick={()=>setCursors(value=>[...value,last])}/></div></section>;
}
