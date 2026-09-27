import React, { useState } from 'react';
import ReportImagePicker from './ReportImagePicker';
import {ModerationButton} from './ReportReviewControls';

const ReportModal = ({ targetType, targetId, onConfirm, onCancel, initialCategory='other', initialMediaUrl, initialMediaType }) => {
    const [selectedImage,setSelectedImage]=useState(initialMediaUrl||'');
    const [availableImages,setAvailableImages]=useState([]);
    const requiresImage=targetType==='creation'&&Boolean(targetId);
    const [category, setCategory] = useState(initialCategory);
    const [reason, setReason] = useState('');
    const [error, setError] = useState('');
    const [busy,setBusy]=useState(false);

    const handleConfirm = async () => {
        if(busy)return;
        if(category==='images'&&requiresImage&&!availableImages.includes(selectedImage)){setError('Select an image to report.');return;}
        if (reason.length > 2000) { setError('Please use at most 2000 characters.'); return; }
        if (reason.trim()) {
            setError('');
            setBusy(true);
            try{await onConfirm(reason, category, category==='images'?selectedImage||undefined:category==='other'&&initialMediaType==='video'?initialMediaUrl:undefined);}
            catch(error){setError(error.message||'The report could not be sent. Please try again.');}
            finally{setBusy(false);}
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50">
            <div role="dialog" aria-modal="true" aria-labelledby="report-dialog-title" className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
                <h3 id="report-dialog-title" className="text-xl font-bold mb-4">Report {targetType}</h3>
                <fieldset disabled={busy}>
                <p className="text-gray-600 mb-4">Please provide a reason for your report. This will be reviewed by our moderation team.</p>
                <p className="text-sm text-gray-600 mb-3">Content must relate to the relevant supported game. You can also report unrelated, harmful or age-inappropriate content here.</p>
                <div className="mb-5">
                    <p id="report-category-label" className="text-sm font-medium text-gray-700 mb-2">What are you reporting?</p>
                    <div role="group" aria-labelledby="report-category-label" className="relative grid grid-cols-3 bg-gray-200 rounded-full p-1 shadow-inner">
                        <span aria-hidden="true" className="absolute top-1 bottom-1 left-1 rounded-full bg-red-500 transition-transform duration-300" style={{width:'calc((100% - 0.5rem) / 3)',transform:`translateX(${['images','text','other'].indexOf(category)*100}%)`}} />
                        {[['images','Images'],['text','Text'],['other','Other']].map(([value,label])=><button key={value} type="button" aria-pressed={category===value} onClick={()=>setCategory(value)} className={`relative z-10 py-2 px-3 rounded-full font-medium transition-colors focus-visible:ring-2 focus-visible:ring-red-600 ${category===value?'text-white':'text-gray-600 hover:text-black'}`}>{label}</button>)}
                    </div>
                </div>
                {category==='images'&&requiresImage&&<ReportImagePicker creationId={targetId} selected={selectedImage} onSelect={setSelectedImage} onImagesLoaded={setAvailableImages}/>}
                {category==='other'&&initialMediaType==='video'&&<p className="text-sm mb-3">This report refers to the selected video.</p>}
                <div>
                    <label htmlFor="report-reason" className="block text-sm font-medium text-gray-700 mb-1">Reason</label>
                    <textarea
                        id="report-reason"
                        value={reason}
                        onChange={(e) => { setReason(e.target.value); setError(''); }}
                        rows="4"
                        maxLength={2000}
                        className="w-full p-2 border border-gray-300 rounded-md shadow-sm focus:ring-red-500 focus:border-red-500"
                        placeholder={`Why are you reporting this ${targetType}?`}
                    />
                    {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
                </div>
                </fieldset>
                <div className="flex flex-wrap justify-end gap-2 mt-6 p-3 bg-gray-50 border-t">
                    <ModerationButton label="Cancel" color="gray" description="Close this dialog without sending a report." disabled={busy} onClick={onCancel}/>
                    <ModerationButton label={busy?'Sending…':'Submit Report'} color="red" description="Send the selected category, image and your explanation to the moderation team. Enter a reason and select an image for an image report." onClick={handleConfirm} disabled={busy||!reason.trim()||(category==='images'&&requiresImage&&!availableImages.includes(selectedImage))}/>
                </div>
            </div>
        </div>
    );
};

export default ReportModal;
