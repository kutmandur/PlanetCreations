"use strict";
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {redaction}=require('./contentReview');
test('media reviews remove only selected references and never alter saves or votes',()=>{
 const original={title:'Park',imageUrls:['https://a.test/a','https://a.test/b'],backupObjectKey:'save',votes:42};
 const key=createHash('sha256').update(original.imageUrls[0]).digest('hex');
 const result=redaction(original,key);
 assert.deepEqual(result.replacement,{imageUrls:['https://a.test/b']});
 assert.deepEqual({...original,...result.replacement, ...result.original},original);
});
test('general reviews retain technical history, roles and save state',()=>{
 const result=redaction({content:'reported text',versionId:'v1',authorId:'a',role:'owner',imageUrls:['a']});
 assert.deepEqual(Object.keys(result.replacement),['content','imageUrls']);
 assert.equal(result.original.content,'reported text');
});

test('profile and community image fields participate in reversible review',()=>{
 const input={name:'Community',profileImageUrl:'community-image',bannerImageUrl:'community-banner',profilePictureUrl:'avatar',profileBannerUrl:'profile-banner',profileMobileBannerUrl:'mobile-banner'};
 const {original,replacement}=redaction(input);
 for(const field of ['profileImageUrl','bannerImageUrl','profilePictureUrl','profileBannerUrl','profileMobileBannerUrl']) assert.equal(replacement[field],'');
 assert.deepEqual({...input,...replacement,...original},input);
});
