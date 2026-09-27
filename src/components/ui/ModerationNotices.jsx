import React, {useEffect,useState} from 'react';
import {collection,onSnapshot} from 'firebase/firestore';
import {getFunctions,httpsCallable} from 'firebase/functions';
import {db} from '../../firebase/config';
import {useNavigate} from 'react-router-dom';
import {ModerationButton} from './ReportReviewControls';
import AccountModerationControls from './AccountModerationControls';
export default function ModerationNotices({userId,selectedCaseId,communityId}) {
    const navigate=useNavigate();
    const [items,setItems]=useState([]),[message,setMessage]=useState(''),[reasons,setReasons]=useState({}),[busy,setBusy]=useState(false);
    const [refresh,setRefresh]=useState(0),[loading,setLoading]=useState(false);
    useEffect(()=>{if(!communityId)return;let active=true;setLoading(true);setItems([]);httpsCallable(getFunctions(),'getCommunityModeration')({communityId}).then(({data})=>{if(active)setItems(data.items.map(item=>({...item,expiresAt:item.expiresAtMillis?{toDate:()=>new Date(item.expiresAtMillis)}:null,updatedAt:{seconds:item.updatedAtMillis/1000}})));}).catch(error=>{if(active)setMessage(error.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[communityId,refresh]);
    const canAppeal=item=>item.canAppeal!==false&&(item.status==='withhold'||(item.status==='reviewing'&&item.canAppeal))&&!(item.expiresAt?.toDate?.().getTime()<=Date.now());
    useEffect(()=>userId?onSnapshot(collection(db,'users',userId,'moderationNotices'),snap=>setItems(snap.docs.map(d=>({id:d.id,...d.data()}))),()=>setMessage('Moderation notices could not be loaded.')):undefined,[userId]);
    return <section className="my-6 border rounded-xl p-4"><div className="flex items-center justify-between gap-2"><h3 className="font-bold">{communityId?'Community moderation':'Content reviews'}</h3>{communityId&&<ModerationButton label="Refresh" description="Reload community and showcase decisions and verify your current appeal permission." disabled={loading||busy} onClick={()=>setRefresh(value=>value+1)}/>}</div>{communityId&&<p className="text-sm my-2">Decisions affecting this community and its showcases. Appeals are reviewed by the platform moderation team. Up to 100 retained cases are shown.</p>}{loading&&<p role="status">Loading decisions…</p>}
        {userId&&<AccountModerationControls targetUserId={userId} ownAccount/>}
        {items.length===0&&<p>No current moderation notices.</p>}
        {selectedCaseId&&!items.some(item=>item.id===selectedCaseId)&&<p>The selected review is no longer available or has expired.</p>}
        {[...items].sort((a,b)=>Number(b.id===selectedCaseId)-Number(a.id===selectedCaseId)||(b.updatedAt?.seconds||0)-(a.updatedAt?.seconds||0)).map(item=><div key={item.id} className={`my-3 border-t pt-3 ${item.id===selectedCaseId?'ring-2 ring-amber-400 rounded p-3':''}`}><p>Status: {item.status}</p><p>{item.reason}</p>
            <p className="text-sm">Review record expires {item.expiresAt?.toDate?.().toLocaleDateString()}. For later questions, use the Legal Notice.</p>
            {item.status==='appealed'&&<p className="text-sm">Your appeal has been received. The moderation team will review it; no further submission is needed.</p>}
            <form onSubmit={async e=>{e.preventDefault();if(busy||!canAppeal(item)||!reasons[item.id]?.trim())return;setBusy(true);try{await httpsCallable(getFunctions(),'appealContentDecision')({caseId:item.id,reason:reasons[item.id]||''});setMessage('Appeal received.');if(communityId)setRefresh(value=>value+1);}catch(error){setMessage(error.message);}finally{setBusy(false);}}}>
                {canAppeal(item)&&<label className="block">Reason for appeal<textarea className="w-full border rounded p-2" required maxLength={2000} value={reasons[item.id]||''} onChange={e=>setReasons({...reasons,[item.id]:e.target.value})}/></label>}
                <div className="mt-3 p-3 bg-gray-50 border-t flex flex-wrap justify-end gap-2">{item.targetPath?.startsWith('/')&&!item.targetPath.startsWith('//')&&<ModerationButton label="View content" description="Open your content. While it is withheld, you can view it but cannot edit it." onClick={()=>navigate(item.targetPath)}/>}{canAppeal(item)&&<ModerationButton type="submit" label="Request another review" color="yellow" description="Send your explanation to the moderation team for another review. The content stays withheld until a decision is made." disabled={busy||!reasons[item.id]?.trim()}/>}</div>
            </form>
        </div>)}{message&&<p role="status">{message}</p>}
    </section>;
}
