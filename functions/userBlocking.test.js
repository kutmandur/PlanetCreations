"use strict";
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {isInteractionBlocked,assertInteractionAllowed,setUserBlock}=require('./userBlocking');
test('blocks apply in both directions, unblock restores interaction',async()=>{
 const docs=new Set(['users/alice/blocks/bob']);
 const db={doc:path=>({get:async()=>({exists:docs.has(path)})})};
 assert.equal(await isInteractionBlocked(db,'alice','bob'),true);
 await assert.rejects(assertInteractionAllowed(db,'bob','alice'),e=>e.code==='permission-denied');
 assert.equal(await isInteractionBlocked(db,'alice','alice'),false);
 docs.clear(); await assertInteractionAllowed(db,'alice','bob');
});
test('block contract rejects unauthenticated, self and malformed targets before writes',async()=>{
 for(const [uid,data,code] of [[null,{},'unauthenticated'],['a',{targetUserId:'a',blocked:true},'invalid-argument'],['a',{targetUserId:'x/y',blocked:true},'invalid-argument'],['a',{targetUserId:'b'},'invalid-argument']]) await assert.rejects(setUserBlock({},uid,data),e=>e.code===code);
});
