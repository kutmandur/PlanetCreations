"use strict";
const {createHash}=require('node:crypto');
const {Timestamp}=require('firebase-admin/firestore');
const OPEN=['open','reviewing','appealed'];
const categoryFor=type=>type==='creation'?'Creations':type==='user'?'Users':'Content';
const keyFor=(type,id)=>createHash('sha256').update(JSON.stringify([type,id])).digest('hex');
async function syncCase(db,type,id) {
    if(!type||!id)return;
    const key=keyFor(type,id),category=categoryFor(type);
    await db.runTransaction(async tx=>{
        // Re-read current reports, never apply event deltas: retries and out-of-order
        // trigger delivery must not resurrect old decisions or double-count reports.
        const reports=await tx.get(db.collection('reports').where('targetType','==',type).where('targetId','==',id));
        const allReports=reports.docs.map(doc=>doc.data());
        const archive=allReports.length>0&&!allReports.some(r=>OPEN.includes(r.status||'open'));
        const locationRef=db.doc(`moderationIndexLocations/${key}`);
        const location=await tx.get(locationRef);
        const oldArchive=location.data()?.archive===true;
        const destination=reports.empty?oldArchive:archive;
        const prefix=destination?'moderationArchive':'moderationIndex';
        const stateRef=db.doc(`${prefix}State/${category}`),state=await tx.get(stateRef);
        const moving=location.exists&&destination!==oldArchive;
        const oldPrefix=oldArchive?'moderationArchive':'moderationIndex';
        const oldStateRef=moving?db.doc(`${oldPrefix}State/${category}`):null;
        const oldState=moving?await tx.get(oldStateRef):null;
        const oldBlockRef=moving?db.doc(`${oldPrefix}Blocks/${location.data().blockId}`):null;
        const oldBlock=moving?await tx.get(oldBlockRef):null;
        if(reports.empty&&!location.exists)return;
        let blockId=(!moving&&location.data()?.blockId)||state.data()?.headBlockId||`${category}-0`;
        let blockRef=db.doc(`${prefix}Blocks/${blockId}`),block=await tx.get(blockRef);
        let entries={...(block.data()?.entries||{})},number=block.data()?.number??state.data()?.number??0;
        if((!location.exists||moving)&&Object.keys(entries).length>=50){
            number=(state.data()?.number||0)+1;blockId=`${category}-${number}`;
            blockRef=db.doc(`${prefix}Blocks/${blockId}`);entries={};
        }
        const oldCount=entries[key]?.reportCount||0;
        if(reports.empty)delete entries[key];
        else {
            const all=reports.docs.map(doc=>doc.data()).sort((a,b)=>(a.timestamp?.toMillis()||0)-(b.timestamp?.toMillis()||0));
            const pending=all.filter(r=>OPEN.includes(r.status||'open'));
            const first=all[0],latest=all[all.length-1];
            const statuses={};for(const report of all){const status=report.status||'open';statuses[status]=(statuses[status]||0)+1;}
            entries[key]={key,id,type,title:String(latest.targetTitle||first.targetTitle||'Reported content').slice(0,250),targetPath:latest.targetPath||first.targetPath||null,reportCount:all.length,pendingCount:pending.length,statuses,firstReportedAt:first.timestamp?.toMillis()||null,dueAt:pending.length?Math.min(...pending.map(r=>r.dueAt?.toMillis()||(r.timestamp?.toMillis()||Date.now())+86400000)):null};
        }
        if(moving){
            const previous={...(oldBlock.data()?.entries||{})};const removed=previous[key]?.reportCount||0;delete previous[key];
            const previousDue=Object.values(previous).map(e=>e.dueAt).filter(Boolean);
            if(Object.keys(previous).length)tx.set(oldBlockRef,{...oldBlock.data(),entries:previous,nextDueAt:previousDue.length?Timestamp.fromMillis(Math.min(...previousDue)):null});
            else tx.delete(oldBlockRef);
            tx.set(oldStateRef,{reportCount:Math.max(0,(oldState.data()?.reportCount||0)-removed)},{merge:true});
        }
        const due=Object.values(entries).map(e=>e.dueAt).filter(Boolean);
        if(!Object.keys(entries).length)tx.delete(blockRef);
        else tx.set(blockRef,{category,number,entries,nextDueAt:due.length?Timestamp.fromMillis(Math.min(...due)):null});
        if(reports.empty)tx.delete(locationRef);else if(!location.exists||moving)tx.set(locationRef,{blockId,archive});
        if(reports.size!==oldCount||!location.exists||moving)tx.set(stateRef,{reportCount:(state.data()?.reportCount||0)+reports.size-oldCount,...(!location.exists||moving?{headBlockId:blockId,number}:{})},{merge:true});
    });
}
async function syncReport(db,change) {
    const summaryFields=['targetType','targetId','targetTitle','targetPath','status','timestamp','dueAt'];
    if(change.before?.exists&&change.after?.exists&&summaryFields.every(field=>JSON.stringify(change.before.data()[field])===JSON.stringify(change.after.data()[field])))return;
    const targets=new Map();
    for(const snap of [change.before,change.after])if(snap?.exists){const r=snap.data();targets.set(keyFor(r.targetType,r.targetId),[r.targetType,r.targetId]);}
    for(const [type,id] of targets.values())await syncCase(db,type,id);
}
module.exports={syncCase,syncReport,keyFor};
