"use strict";
const {notifyUser}=require('./notify');
const {Timestamp}=require('firebase-admin/firestore');
const OPEN=['open','reviewing','appealed'];
async function alertStaff(db,{title,message,eventKey}) {
    const staff=await db.collection('profiles').where('role','in',['admin','moderator']).get();
    for(const person of staff.docs)await notifyUser(person.id,'moderationQueue',{title,message,link:'/moderation',eventKey});
}
async function reportCreated(db,snap) {
    if(!OPEN.includes(snap.data()?.status||'open'))return;
    await alertStaff(db,{title:'New content report',message:'A report is waiting for platform review. A report never automatically withholds content.',eventKey:`report-${snap.id}`});
}
async function remindOverdue(db) {
    const day=new Date().toISOString().slice(0,10),marker=db.doc('moderationIndexMaintenance/reminders');
    if((await marker.get()).data()?.day===day)return {skipped:true};
    const now=Date.now();let cursor,overdue=0;
    do {
        let query=db.collection('moderationIndexBlocks').where('nextDueAt','>',Timestamp.fromMillis(0)).where('nextDueAt','<=',Timestamp.fromMillis(now)).orderBy('nextDueAt').limit(100);
        if(cursor)query=query.startAfter(cursor);
        const page=await query.get();
        overdue+=page.docs.reduce((sum,doc)=>sum+Object.values(doc.data().entries||{}).filter(entry=>entry.dueAt&&entry.dueAt<=now).length,0);
        cursor=page.size===100?page.docs.at(-1):null;
    }while(cursor);
    if(overdue){
        await alertStaff(db,{title:'Moderation review overdue',message:`${overdue} cases have exceeded the internal 24-hour review target. Please review the queue.`,eventKey:`moderation-overdue-${day}`});
        await marker.set({day});
    }
    return {overdue};
}
module.exports={reportCreated,remindOverdue,alertStaff};
