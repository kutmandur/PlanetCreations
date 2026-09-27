import React,{useEffect,useState} from 'react';
import {getFunctions,httpsCallable} from 'firebase/functions';
import AccountModerationControls from '../ui/AccountModerationControls';
import {ModerationButton} from '../ui/ReportReviewControls';
export default function AccountModerationManager(){
 const [items,setItems]=useState([]),[uid,setUid]=useState(''),[selected,setSelected]=useState(''),[message,setMessage]=useState('');
 const refresh=async()=>{try{const {data}=await httpsCallable(getFunctions(),'listAccountModeration')({});setItems(data.items);setMessage('');}catch(error){setMessage(error.message);}};
 useEffect(()=>{refresh();},[]);
 return <section><h2 className="font-bold text-xl">Account restrictions and appeals</h2><p>Review the evidence before applying sanctions. Report volume alone is never a reason to suspend an account. Up to 100 cases per restriction type are listed.</p><div className="flex flex-wrap gap-2 my-3"><label>Account UID<input className="border rounded p-2 mx-2" value={uid} onChange={event=>setUid(event.target.value)}/></label><ModerationButton label="Open account" description="Inspect account moderation for this UID." disabled={!/^[A-Za-z0-9_-]{1,128}$/.test(uid)} onClick={()=>setSelected(uid)}/><ModerationButton label="Refresh" description="Reload active restrictions and pending account appeals." onClick={refresh}/></div>{message&&<p role="status">{message}</p>}{items.map(item=><div className="my-2" key={item.userId}><ModerationButton label={`${item.appealPending?'Appeal pending: ':'Restricted: '}${item.userId}`} description="Open this account’s restriction and appeal." onClick={()=>setSelected(item.userId)}/></div>)}{selected&&<AccountModerationControls key={selected} targetUserId={selected}/>}</section>;
}
