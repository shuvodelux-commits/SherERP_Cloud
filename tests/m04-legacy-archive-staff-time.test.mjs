import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  excel1900DhakaSerialToUtc,
  provisionallyConvertLegacyStaffExcelDates,
} from '../src/auth/legacy-archive-staff-time.js';

const HASH='a'.repeat(64);
const SALT='1'.repeat(8)+'-'+ '2'.repeat(4)+'-'+'3'.repeat(4)+'-'+'4'.repeat(4)+'-'+'5'.repeat(12);
const user=(id,role='Administrator',mobile='01712345678')=>({
 'User ID':id,'Full Name':'SYNTHETIC_PRIVATE_NAME_'+id,
 'Mobile Number':mobile,'Password Hash':HASH,'Password Salt':SALT,
 'Role':role,'Status':'Active','Created By':'SYNTHETIC_PRIVATE_ACTOR',
 'Created At':'45658.5','Last Login':'45658.75',
});
const role=(id)=>({
 'Role ID':id,'Role Name':'Sales','Allowed Modules':'products',
 'Permissions':'{"products":{"view":true}}','Status':'Active',
 'Created At':'45658.25',
});
const sample=()=>({users:[user('SYNTH-1'),user('SYNTH-2','Owner','123456')],roles:[role('ROL-SYNTH-1')]});
const options=()=>({workbookEpoch:1900,scriptTimeZone:'Asia/Dhaka'});

test('Excel 1900 date-system serials use pinned source Asia/Dhaka script clock, not UTC-as-input',()=>{
 assert.equal(excel1900DhakaSerialToUtc('45658.5'),'2025-01-01T06:00:00.000Z');
 assert.equal(excel1900DhakaSerialToUtc('45658'),'2024-12-31T18:00:00.000Z');
 assert.equal(excel1900DhakaSerialToUtc('45658.75'),'2025-01-01T12:00:00.000Z');
 assert.equal(excel1900DhakaSerialToUtc('45658.25'),'2025-01-01T00:00:00.000Z');
 assert.equal(excel1900DhakaSerialToUtc('45658.500001'),'2025-01-01T06:00:00.086Z');
});
test('original staff fields are preserved unchanged; UTC projection is a detached, provisional copy',()=>{
 const before=sample();
 const original=JSON.stringify(before);
 const converted=provisionallyConvertLegacyStaffExcelDates(before,options());
 const {snapshot,report}=converted;
 assert.equal(JSON.stringify(before),original);
 assert.notEqual(snapshot,before);
 assert.notEqual(snapshot.users[0],before.users[0]);
 assert.equal(snapshot.users[0]['Created At'],'2025-01-01T06:00:00.000Z');
 assert.equal(snapshot.users[0]['Last Login'],'2025-01-01T12:00:00.000Z');
 assert.equal(snapshot.roles[0]['Created At'],'2025-01-01T00:00:00.000Z');
 assert.equal(snapshot.users[0]['Password Hash'],HASH);
 assert.equal(snapshot.users[0]['Password Salt'],SALT);
 assert.equal(snapshot.users[0]['User ID'],before.users[0]['User ID']);
 assert.equal(snapshot.users[1]['Mobile Number'],'123456','invalid Owner phone must not be fabricated');
 assert.equal(snapshot.roles[0].Permissions,before.roles[0].Permissions);
 assert.equal(report.users,2);
 assert.equal(report.roles,1);
 assert.equal(report.convertedTimestamps,5);
 assert.equal(report.spreadsheetTimezoneVerified,false);
 assert.equal(report.originalSourceChanged,false);
 assert.equal(report.legacyStaffImportAuthorized,false);
 assert.equal(report.publicAuthenticationEnabled,false);
 assert.equal(report.productionReady,false);
 for(const privateText of ['SYNTHETIC_PRIVATE_NAME','SYNTHETIC_PRIVATE_ACTOR',HASH,SALT,'01712345678']){
  assert.equal(JSON.stringify(report).includes(privateText),false);
 }
});
test('source Last Login empty is preserved as blank rather than a synthetic login timestamp',()=>{
 const s=sample();s.users[0]['Last Login']='';
 const {snapshot,report}=provisionallyConvertLegacyStaffExcelDates(s,options());
 assert.equal(snapshot.users[0]['Last Login'],'');
 assert.equal(report.convertedTimestamps,4);
});
test('unreviewed epoch, timezone or malformed Excel serials fail without leaking original fields',()=>{
 const bad=[
  {workbookEpoch:1904,scriptTimeZone:'Asia/Dhaka'},
  {workbookEpoch:1900,scriptTimeZone:'UTC'},
  {workbookEpoch:1900,scriptTimeZone:'Asia/Dhaka',importAuthorized:true},
 ];
 for(const opts of bad)assert.throws(()=>provisionallyConvertLegacyStaffExcelDates(sample(),opts),/M04 private source timestamp preparation rejected/);
 for(const value of ['45658.5Z','2025-01-01','1e3','NaN','Infinity','',null,0,'60','40000.1','99999.8','45000.2; SELECT', '45658.12345678901234567890']){
  assert.throws(()=>excel1900DhakaSerialToUtc(value),/M04 private source timestamp preparation rejected/);
 }
});
test('missing/unknown fields, extra sessions, non-plain rows and accessor properties fail closed',()=>{
 const invalid=[
  {...sample(),sessions:[]},
  {...sample(),users:[{...user('SYNTH-1'),unknown:'SENSITIVE'},user('SYNTH-2')]},
  {...sample(),users:[{'User ID':'SYNTH-1'},user('SYNTH-2')]},
  {...sample(),roles:[]},
 ];
 for(const source of invalid)assert.throws(()=>provisionallyConvertLegacyStaffExcelDates(source,options()),/M04 private source timestamp preparation rejected/);
 const injected=sample();
 let accesses=0;
 Object.defineProperty(injected.users[0],'Created At',{enumerable:true,get(){accesses++;throw Error('SENSITIVE_ACCESSOR_TOKEN');}});
 assert.throws(()=>provisionallyConvertLegacyStaffExcelDates(injected,options()),e=>{
  assert.equal(e.message,'M04 private source timestamp preparation rejected');return true;
 });
 assert.equal(accesses,0);
});
test('private source timestamp preparation is not connected to the public Worker or RPC',()=>{
 const src=readFileSync(new URL('../src/auth/legacy-archive-staff-time.js',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
 const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
 assert.doesNotMatch(src,/\bconsole\.|\bfetch\(|\bD1\b|\.prepare\(|\bexec\(/);
 assert.doesNotMatch(worker+rpc,/provisionallyConvertLegacyStaffExcelDates|excel1900DhakaSerialToUtc/);
});