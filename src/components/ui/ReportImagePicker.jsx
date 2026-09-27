import React,{useEffect,useState} from 'react';
import {doc,getDoc} from 'firebase/firestore';
import {db} from '../../firebase/config';
export default function ReportImagePicker({creationId,selected,onSelect,onImagesLoaded}) {
    const [images,setImages]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
    useEffect(()=>{let active=true;setLoading(true);setError('');
        getDoc(doc(db,'creations',creationId)).then(snap=>{if(active){const urls=[...new Set(snap.data()?.imageUrls||[])];setImages(urls);onImagesLoaded?.(urls);}}).catch(()=>{if(active)setError('Images could not be loaded. Please try again.');}).finally(()=>{if(active)setLoading(false);});
        return ()=>{active=false;};
    },[creationId]);
    return <fieldset className="mb-4"><legend className="text-sm font-semibold mb-2">Select the image you want to report</legend>
        {loading?<p role="status">Loading images…</p>:error?<p role="alert">{error}</p>:images.length===0?<p>No images are currently available for this creation.</p>:<div className="grid grid-cols-3 gap-2 max-h-56 overflow-y-auto p-1">{images.map((url,index)=><button type="button" key={url} aria-label={`Select image ${index+1}`} aria-pressed={selected===url} onClick={()=>onSelect(url)} className={`rounded-lg border-2 p-1 ${selected===url?'border-red-500 ring-2 ring-red-300':'border-gray-200 hover:border-gray-400'}`}><img src={url} alt={`Creation image ${index+1}`} className="w-full h-20 object-cover rounded"/><span className="text-xs">Image {index+1}</span></button>)}</div>}
    </fieldset>;
}
