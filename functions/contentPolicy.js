"use strict";
const {HttpsError}=require('firebase-functions/v2/https');
const {FieldValue}=require('firebase-admin/firestore');
const DEFAULT_POLICY_TERMS=Object.freeze(['child pornography','child porn','rape you','kill yourself','kinderpornografie','kinderpornographie','bring dich um']);
const normalizeText = value => String(value || '').normalize('NFKC').replace(/[\u200B-\u200D\uFEFF]/g,'').toLowerCase();
function compilePolicy(words) {
    if(!Array.isArray(words)||words.length>500) throw new HttpsError('invalid-argument','Use at most 500 policy terms.');
    const custom=[...new Set(words.map(normalizeText).map(w=>w.trim()).filter(Boolean))];
    const normalized=custom.length?custom:[...DEFAULT_POLICY_TERMS];
    if(normalized.some(w=>w.length>100)) throw new HttpsError('invalid-argument','Policy terms must be at most 100 characters.');
    const escaped=normalized.map(w=>w.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
    const pattern=escaped.length ? `(^|.*[^a-z0-9_])(${escaped.join('|')})([^a-z0-9_].*|$)` : '^a^';
    if(pattern.length>20000) throw new HttpsError('invalid-argument','The text policy is too large.');
    return {words:normalized,pattern,version:1};
}
function findRejectedFields(fields,policy) {
    if(!policy?.pattern) return [];
    const regex=new RegExp(policy.pattern,'s');
    return Object.entries(fields).filter(([,value])=>typeof value==='string' && regex.test(normalizeText(value))).map(([key])=>key);
}
function extractTextFields(value, prefix='', result={}) {
    if(!value || typeof value!=='object') return result;
    for(const [key,item] of Object.entries(value)) {
        if(typeof item==='string' && ['title','description','text','changelog','note','initialNote','message'].includes(key)) result[prefix+key]=item;
        else if(item && typeof item==='object') extractTextFields(item,prefix+key+'.',result);
    }
    return result;
}
async function validateContentText(db,fields) {
    const policy=(await db.doc('meta/blacklist').get()).data();
    // Derive from the terms so missing/stale permissive patterns never disable validation.
    const rejected=findRejectedFields(fields,compilePolicy(policy?.words||[]));
    if(rejected.length) throw new HttpsError('invalid-argument',`Please revise these fields to follow the Community Content Guidelines: ${rejected.join(', ')}. Your draft has not been changed.`,{fields:rejected});
    return {valid:true,policyVersion:1};
}
async function updateContentPolicy(db,uid,data) {
    if(!uid || !['admin','moderator'].includes((await db.doc(`profiles/${uid}`).get()).data()?.role)) throw new HttpsError('permission-denied','Moderation access required.');
    return db.runTransaction(async tx=>{
        const ref=db.doc('meta/blacklist'),snap=await tx.get(ref);
        let words=snap.data()?.words||[];
        if(data?.action==='add' && typeof data.word==='string') words=[...words,data.word];
        else if(data?.action==='remove' && typeof data.word==='string') words=words.filter(w=>normalizeText(w)!==normalizeText(data.word));
        else if(data?.action!=='publish') throw new HttpsError('invalid-argument','Choose add, remove or publish.');
        const policy=compilePolicy(words);
        tx.set(ref,{...policy,updatedAt:FieldValue.serverTimestamp()});
        return {published:true,termCount:policy.words.length};
    });
}
module.exports={DEFAULT_POLICY_TERMS,extractTextFields,normalizeText,compilePolicy,findRejectedFields,validateContentText,updateContentPolicy};
