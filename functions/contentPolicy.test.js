"use strict";
const {test}=require('node:test'); const assert=require('node:assert/strict');
const {compilePolicy,findRejectedFields}=require('./contentPolicy');
test('text policy normalizes evasions, escapes literal terms and keeps ordinary words',()=>{
 const policy=compilePolicy(['badword','literal.*']);
 assert.deepEqual(findRejectedFields({title:'A BAD\u200bWORD park',description:'ｂａｄｗｏｒｄ'},policy),['title','description']);
 assert.deepEqual(findRejectedFields({title:'badwording safari',description:'literal characters'},policy),[]);
 assert.deepEqual(findRejectedFields({title:'literal.*'},policy),['title']);
 assert.deepEqual(findRejectedFields({title:'anything'},compilePolicy([])),[]);
});
test('policy configuration is bounded',()=>{assert.throws(()=>compilePolicy(Array(501).fill('a')));assert.throws(()=>compilePolicy(['x'.repeat(101)]));});

test('missing and empty policies retain baseline filtering without blocking ordinary game text',async()=>{
 const {validateContentText,DEFAULT_POLICY_TERMS}=require('./contentPolicy');
 for(const data of [undefined,{words:[],pattern:'^a^'}]){
  const db={doc:()=>({get:async()=>({data:()=>data})})};
  await assert.rejects(validateContentText(db,{description:'kill yourself'}),e=>e.code==='invalid-argument');
  await validateContentText(db,{title:'A spooky coaster and animal park'});
 }
 const rules=require('node:fs').readFileSync(require('node:path').join(__dirname,'../firestore.rules'),'utf8');
 for(const term of DEFAULT_POLICY_TERMS)assert.ok(rules.includes(term));
});
