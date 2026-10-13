const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {readAnalysisPreferences,setAnalysisPreference,analysisEnabled}=require('./SaveAnalysisSettings');
test('save analysis defaults off, persists per game and fails closed for corrupt settings',t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'analysis-settings-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 assert.ok(Object.values(readAnalysisPreferences(root)).every(value=>value===false));
 setAnalysisPreference(root,'planet-zoo-2',true);
 assert.equal(analysisEnabled(root,'C:/Frontier/Planet Zoo 2/123/Saves/test.zoo'),true);
 assert.equal(analysisEnabled(root,'C:/Frontier/Planet Zoo/123/Saves/test.zoo'),false);
 setAnalysisPreference(root,'planet-zoo-2',false);
 assert.equal(analysisEnabled(root,'test.zblpr'),false);
 assert.throws(()=>setAnalysisPreference(root,'unknown',true));
 fs.writeFileSync(path.join(root,'save-analysis-settings.json'),'invalid');
 assert.ok(Object.values(readAnalysisPreferences(root)).every(value=>value===false));
});

test('disabled analysis lists saves without parsing and refuses explicit analysis', async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'analysis-disabled-'));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const Module=require('node:module');const original=Module._load;
 Module._load=function(name,...args){if(name==='electron')return {app:{getPath:()=>root}};return original.call(this,name,...args)};
 const handler=require('./FileHandler');Module._load=original;
 const saves=path.join(root,'Planet Coaster 2','12345678901234567','Saves');fs.mkdirSync(saves,{recursive:true});
 const file=path.join(saves,'test.park2');fs.writeFileSync(file,'not a valid save');
 const result=handler.indexGamesFromPath(root);
 assert.equal(result.pending.length,0);
 assert.equal(result.results['Planet Coaster 2'].parks[0].metadataStatus,'disabled');
 await assert.rejects(handler.inspectFrontierFileInWorker(file),/disabled/);
 setAnalysisPreference(root,'planet-coaster-2',true);
 assert.equal(handler.indexGamesFromPath(root).pending.length,1);
});
