'use strict';
// Run before deploying queries/rules that require moderationWithheld.
// Dry run by default: node scripts/migrate-creation-visibility.cjs --project=<id>
// Apply explicitly with --apply. Existing visibility decisions are never overwritten.
const {createRequire}=require('node:module');
const path=require('node:path');
const req=createRequire(path.resolve(__dirname,'../functions/package.json'));
const {initializeApp}=req('firebase-admin/app');
const {getFirestore}=req('firebase-admin/firestore');
const project=process.argv.find(a=>a.startsWith('--project='))?.slice(10);
if(!project)throw new Error('An explicit --project=<id> is required.');
if(process.env.FIRESTORE_EMULATOR_HOST&&!project.startsWith('demo-'))throw new Error('Use a demo project with the emulator.');
initializeApp({projectId:project});const db=getFirestore();
(async()=>{
 const reviews=await db.collection('contentReviews').where('targetType','==','creation').get();
 const byCreation=new Map();
 for(const review of reviews.docs){const data=review.data();if(Object.keys(data.original||{}).length){const refs=byCreation.get(data.targetId)||[];refs.push(review.ref);byCreation.set(data.targetId,refs);}}
 const creations=await db.collection('creations').get();let changed=0;
 for(const creation of creations.docs){if(typeof creation.data().moderationWithheld==='boolean')continue;
  changed++;
  if(!process.argv.includes('--apply'))continue;
  await db.runTransaction(async tx=>{
   const current=await tx.get(creation.ref);if(!current.exists||typeof current.data().moderationWithheld==='boolean')return;
   const refs=byCreation.get(creation.id)||[];
   const snapshots=await Promise.all(refs.map(ref=>tx.get(ref)));
   const holds=Object.fromEntries(snapshots.filter(s=>s.exists&&Object.keys(s.data().original||{}).length).map(s=>[s.id,true]));
   tx.update(creation.ref,{moderationWithheld:Object.keys(holds).length>0,moderationHolds:holds});
  });
 }
 console.log(JSON.stringify({project,mode:process.argv.includes('--apply')?'apply':'dry-run',creations:creations.size,initialized:changed}));
})().catch(error=>{console.error(error);process.exitCode=1;});
