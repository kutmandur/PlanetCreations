// Compile existing moderation terms without overwriting a concurrent staff edit.
const {createRequire}=require('node:module');
const req=createRequire(require('node:path').resolve(__dirname,'../functions/package.json'));
const {initializeApp,deleteApp}=req('firebase-admin/app');
const {getFirestore,FieldValue}=req('firebase-admin/firestore');
const {compilePolicy}=req('./contentPolicy');
const projectId=process.argv[2];
if(!projectId)throw Error('Usage: node scripts/publish-content-policy.cjs <project-id>');
const app=initializeApp({projectId}),db=getFirestore(app);
db.runTransaction(async tx=>{
 const ref=db.doc('meta/blacklist'),snap=await tx.get(ref);
 const policy=compilePolicy(snap.data()?.words||[]);
 tx.set(ref,{...policy,updatedAt:FieldValue.serverTimestamp()},{merge:true});
 return policy.words.length;
}).then(count=>console.log(`Published ${count} text policy terms in ${projectId}.`))
.catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>deleteApp(app));
