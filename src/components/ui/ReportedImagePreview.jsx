import React,{useEffect,useState} from 'react';
import {doc,getDoc} from 'firebase/firestore';
import {db} from '../../firebase/config';
export default function ReportedImagePreview({report,review}) {
    const video=report.mediaType==='video';
    const [open,setOpen]=useState(false),[image,setImage]=useState(null),[loading,setLoading]=useState(false);
    useEffect(()=>{let active=true;if(!open)return;setLoading(true);setImage(null);
        (async()=>{try{const snap=await getDoc(doc(db,'creations',report.targetId));
            const field=video?'videoUrls':'imageUrls';
            const urls=[...new Set([...(snap.data()?.[field]||[]),...(review?.original?.[field]||[]),...(review?.retainedEvidence?.[field]||[])])];
            for(const url of urls){const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(url)))).map(b=>b.toString(16).padStart(2,'0')).join('');if(hash===report.mediaKey){if(active)setImage(url);break;}}
        }finally{if(active)setLoading(false);}})().catch(()=>{});
        return ()=>{active=false;};
    },[open,report.targetId,report.mediaKey,review,video]);
    return <details onToggle={event=>setOpen(event.currentTarget.open)} className="rounded border p-2"><summary className="cursor-pointer font-semibold">{video?'Reported video':'Reported image'}</summary>{open&&(loading?<p>Loading reported image…</p>:image&&/^https?:/.test(image)?video?<a href={image} target="_blank" rel="noopener noreferrer" title="Open the reported video in a new tab." className="inline-block mt-2 bg-blue-500 hover:bg-blue-600 text-white rounded-md px-3 py-1 text-sm font-semibold">View reported video</a>:<img src={image} alt="Reported creation image" className="mt-2 max-h-72 w-full object-contain rounded"/>:<p>The reported media is no longer available.</p>)}</details>;
}
