import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  makePrivateM04StaffIntent,
  submitApprovedPrivateM04StaffImport,
  readVerifiedPrivateM04ArchiveTwoPass,
} from '../scripts/m04-private-archive-client.mjs';

const SALT='123e4567-e89b-42d3-a456-426614174000';
const HASH=createHash('sha256').update('SyntheticPrivateClientPassword!'+SALT).digest('hex');
const RIGHTS=JSON.stringify({products:{
 view:true,add:false,edit:false,delete:'disabled',backdate:'unlimited',
}});
const user=(id,phone,role)=>({
 'User ID':id,'Full Name':'Synthetic '+id,'Mobile Number':phone,
 'Password Hash':HASH,'Password Salt':SALT,'Role':role,'Status':'Active',
 'Created By':'Synthetic test actor','Created At':'2025-01-20T12:05:06.000Z',
 'Last Login':'2025-06-30T08:09:10.000Z',
});
const source=()=>({users:[
 user('USR-ADM','1790000701','Administrator'),
 user('USR-OWNER','123456','Owner'),
 user('USR-SALES','01790000703','Sales'),
],roles:[
 {'Role ID':'ROL-OWNER','Role Name':'Owner','Allowed Modules':'products',
  'Permissions':RIGHTS,'Status':'Active','Created At':'2025-01-20T12:06:07.000Z'},
 {'Role ID':'ROL-SALES','Role Name':'Sales','Allowed Modules':'products',
  'Permissions':RIGHTS,'Status':'Active','Created At':'2025-01-20T12:06:07.000Z'},
]});
const approval=()=>({
 scope:'private-staging-staff-import-only',
 reviewedOperator:true,
 independentlyCapturedSourceApproved:true,
 originalSpreadsheetTimezoneAttested:true,
 currentStagingBackupRestoreVerified:true,
 freshTimeTravelBookmarkSecured:true,
 singleStagingWriterConfirmed:true,
});
const token='synthetic-only-m04-private-client-token-with-minimum-length';
const stash=()=>{
 const dir=mkdtempSync(join(tmpdir(),'m04-client-test-'));
 const filename=join(dir,'.dev.vars');
 writeFileSync(filename,'M04_IMPORT_TOKEN='+token+'\n',{mode:0o600});
 return {dir,filename};
};
test('read-only archive reader rejects unverified or missing archive with no data output',()=>{
 assert.throws(()=>readVerifiedPrivateM04ArchiveTwoPass('/does/not/exist.sqlite'),/M04 private client rejected/);
});
test('source-compatible 10-digit Administrator mobile is accepted without altering original Owner',()=>{
 const a=source(),b=source();
 const result=makePrivateM04StaffIntent(a,b);
 assert.equal(result.report.originalUsers,3);
 assert.equal(result.report.importableUsers,2);
 assert.equal(result.report.deferredOwnerUsers,1);
 assert.equal(result.report.originalSourceChanged,false);
 assert.equal(result.report.independentlyCapturedSourceAttested,false);
 assert.equal(a.users[1].Status,'Active');
 assert.equal(a.users[0]['Mobile Number'],'1790000701');
 assert.doesNotMatch(JSON.stringify(result.report),/USR-|1790000701|123456|Synthetic|Password|123e4567/);
});
test('incomplete source, changed Owner and missing operator approvals never reach transport',async()=>{
 let called=0;
 const transport=async()=>{called++;return new Response('{}',{status:200});};
 const {dir,filename}=stash();
 try{
  await assert.rejects(()=>submitApprovedPrivateM04StaffImport({
   first:source(),confirmation:source(),tokenFile:filename,
   approval:{...approval(),originalSpreadsheetTimezoneAttested:false},transport,
  }),/M04 private client rejected/);
  const a=source(),b=source();b.users[1].Status='Inactive';
  await assert.rejects(()=>submitApprovedPrivateM04StaffImport({
   first:a,confirmation:b,tokenFile:filename,approval:approval(),transport,
  }),/M04 private client rejected/);
  assert.equal(called,0);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('token must come from protected 0600 private file, not argv or URL',async()=>{
 const {dir,filename}=stash();
 try{
  chmodSync(filename,0o644);
  await assert.rejects(()=>submitApprovedPrivateM04StaffImport({
   first:source(),confirmation:source(),tokenFile:filename,
   approval:approval(),transport:async()=>{throw new Error('SHOULD_NOT_CALL');},
  }),/M04 private client rejected/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('approved single loopback POST sends two complete source captures and returns only redacted counts',async()=>{
 const {dir,filename}=stash();
 let calls=0;
 try{
  const result=await submitApprovedPrivateM04StaffImport({
   first:source(),confirmation:source(),tokenFile:filename,approval:approval(),
   transport:async (url,init)=>{
    calls++;
    assert.equal(url,'http://127.0.0.1:8787/_private/m04/staff-import-once');
    assert.equal(init.method,'POST');
    assert.equal(init.redirect,'error');
    assert.equal(init.headers.authorization,'Bearer '+token);
    assert.equal(init.headers['content-type'],'application/json');
    const request=JSON.parse(init.body);
    assert.equal(request.first.users.length,3);
    assert.equal(request.confirmation.roles.length,2);
    return new Response(JSON.stringify({
     imported:true,originalUsers:3,importedUsers:2,importedRoles:2,
     pendingLegacyCredentials:2,deferredOwnerUsers:1,
     sourceTwoPassMatch:true,readbackMatch:true,
     publicAuthenticationEnabled:false,productionReady:false,
    }),{status:200,headers:{'content-type':'application/json; charset=utf-8'}});
   },
  });
  assert.equal(calls,1);
  assert.deepEqual(result,{imported:true,originalUsers:3,importedUsers:2,
   importedRoles:2,pendingLegacyCredentials:2,deferredOwnerUsers:1,
   sourceTwoPassMatch:true,readbackMatch:true,
   publicAuthenticationEnabled:false,productionReady:false});
  assert.doesNotMatch(JSON.stringify(result),/USR-|1790000701|123456|Synthetic|Password|123e4567/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('failed or ambiguous response never retries, returns only fixed rejection',async()=>{
 const {dir,filename}=stash();
 let called=0;
 try{
  await assert.rejects(()=>submitApprovedPrivateM04StaffImport({
   first:source(),confirmation:source(),tokenFile:filename,approval:approval(),
   transport:async()=>{called++;return new Response('private backend error',{status:409});},
  }),err=>err?.message==='M04 private client rejected');
  assert.equal(called,1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('success without JSON media type or with non-UTF8 charset fails closed',async()=>{
 const {dir,filename}=stash();
 let calls=0;
 try{
  for(const mime of ['text/html','application/jsonp','application/json; charset=iso-8859-1']){
   await assert.rejects(()=>submitApprovedPrivateM04StaffImport({
    first:source(),confirmation:source(),tokenFile:filename,approval:approval(),
    transport:async()=>{calls++;return new Response(JSON.stringify({
     imported:true,originalUsers:3,importedUsers:2,importedRoles:2,
     pendingLegacyCredentials:2,deferredOwnerUsers:1,
     sourceTwoPassMatch:true,readbackMatch:true,
     publicAuthenticationEnabled:false,productionReady:false,
    }),{status:200,headers:{'content-type':mime}});},
   }),err=>err?.message==='M04 private client rejected');
  }
  assert.equal(calls,3);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
