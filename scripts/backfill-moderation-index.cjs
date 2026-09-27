// Run against the explicitly selected project after deploying the index trigger.
// Repeatable: syncCase always reads current source records inside a transaction.
const {createRequire}=require('module');
const req=createRequire(require('path').resolve(__dirname,'../functions/package.json'));
const {initializeApp,deleteApp}=req('firebase-admin/app');
const {getFirestore,FieldPath}=req('firebase-admin/firestore');
const {syncCase,keyFor}=req('./moderationIndex');
const projectId=process.argv[2];
if(!projectId)throw Error('Usage: node scripts/backfill-moderation-index.cjs <project-id>');
const app=initializeApp({projectId}),db=getFirestore(app);
(async()=>{
 let cursor,count=0;const seen=new Set();
 do {
  let query=db.collection('reports').orderBy(FieldPath.documentId()).limit(200);
  if(cursor)query=query.startAfter(cursor);
  const page=await query.get();
  for(const doc of page.docs){const report=doc.data();if(!report.targetType||!report.targetId)continue;const key=keyFor(report.targetType,report.targetId);if(seen.has(key))continue;seen.add(key);await syncCase(db,report.targetType,report.targetId);count++;}
  cursor=page.size===200?page.docs.at(-1):null;
 }while(cursor);
 // Remove stale summaries too when re-running after missed deletions.
 for(const blocks of ['moderationIndexBlocks','moderationArchiveBlocks']){
 let blockCursor;
 do {
  let query=db.collection(blocks).orderBy(FieldPath.documentId()).limit(100);
  if(blockCursor)query=query.startAfter(blockCursor);
  const page=await query.get();
  for(const doc of page.docs)for(const entry of Object.values(doc.data().entries||{}))if(!seen.has(entry.key))await syncCase(db,entry.type,entry.id);
  blockCursor=page.size===100?page.docs.at(-1):null;
 }while(blockCursor);
 }
 console.log(`Indexed ${count} moderation cases in ${projectId}.`);
})().catch(error=>{console.error(error);process.exitCode=1;}).finally(()=>deleteApp(app));
