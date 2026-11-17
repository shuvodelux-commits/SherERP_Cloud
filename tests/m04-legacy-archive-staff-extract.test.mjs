import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {extractPrivateLegacyStaffFromArchive} from '../src/auth/legacy-archive-staff-extract.js';
import {provisionallyConvertLegacyStaffExcelDates} from '../src/auth/legacy-archive-staff-time.js';

const schema=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const hash=x=>createHash('sha256').update(x).digest('hex');
const quote=x=>'"'+x.replaceAll('"','""')+'"';
const secret='SYNTHETIC_PRIVATE_SECRET_001';
const sourceUser={
 'User ID':'USR-SYNTH-1','Full Name':'SYNTHETIC_PRIVATE_NAME',
 'Mobile Number':'01712345678','Password Hash':'a'.repeat(64),
 'Password Salt':'00000000-0000-4000-8000-000000000000',
 'Role':'Administrator','Status':'Active',
 'Created By':'SYNTHETIC_PRIVATE_ACTOR',
 'Created At':'45658.5','Last Login':'45658.75',
};
const sourceRole={
 'Role ID':'ROL-SYNTH-1','Role Name':'Sales','Allowed Modules':'products',
 'Permissions':'{"products":{"view":true}}',
 'Status':'Active','Created At':'45658.25',
};
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec('CREATE TABLE archive_sheets (sheet_key TEXT,sql_table TEXT,actual_headers_json TEXT,header_count INTEGER,populated_data_rows INTEGER,physical_data_rows INTEGER)');
 db.exec('CREATE TABLE archive_source_parts (chunk_number INTEGER PRIMARY KEY,sha256 TEXT,data BLOB)');
 db.exec('CREATE TABLE archive_info (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 const original=Buffer.from('SYNTHETIC_PROVENANCE_XLSX');
 db.prepare('INSERT INTO archive_source_parts VALUES(?,?,?)').run(0,hash(original),original);
 db.prepare('INSERT INTO archive_info VALUES(?,?)').run('original_xlsx_sha256',hash(original));
 for(const sheet of schema.tables){
  const fields=sheet.columns,table='legacy_'+sheet.sheetKey.toLowerCase();
  const originalRow=sheet.sheetKey==='USERS'?sourceUser:sheet.sheetKey==='ROLES'?sourceRole:sheet.sheetKey==='SESSIONS'?{'Token':secret,'User ID':'USR-SYNTH-1'}:null;
  db.exec('CREATE TABLE '+quote(table)+' (__excel_row INTEGER PRIMARY KEY,__has_data INTEGER,__cells_json TEXT,__row_sha256 TEXT,'+fields.map(f=>quote(f)+' TEXT').join(',')+')');
  db.prepare('INSERT INTO archive_sheets VALUES(?,?,?,?,?,?)').run(sheet.sheetKey,table,JSON.stringify(fields),fields.length,originalRow?1:0,originalRow?1:0);
  if(!originalRow)continue;
  const values=fields.map(f=>Object.hasOwn(originalRow,f)?originalRow[f]:null);
  const meta={};
  for(const [field,letter,style] of sheet.sheetKey==='USERS'?[['Created At','I','5'],['Last Login','J','4']]:sheet.sheetKey==='ROLES'?[['Created At','F','5']]:[]){
   meta[letter]={s:style,t:'n',v:originalRow[field]};
  }
  const cells=JSON.stringify(meta);
  db.prepare('INSERT INTO '+quote(table)+' VALUES ('+Array(fields.length+4).fill('?').join(',')+')').run(2,1,cells,hash(JSON.stringify([2,values,cells])),...values);
 }
 db.exec('CREATE TABLE legacy_sheet1 (__excel_row INTEGER PRIMARY KEY,__has_data INTEGER,__cells_json TEXT,__row_sha256 TEXT)');
 db.prepare('INSERT INTO archive_sheets VALUES(?,?,?,?,?,?)').run('SHEET1','legacy_sheet1','[]',0,0,0);
 return db;
}
function updateStaffMetadata(db,table,letter,change){
 const row=db.prepare('SELECT * FROM "'+table+'" WHERE __excel_row=2').get();
 const fields=schema.tables.find(t=>'legacy_'+t.sheetKey.toLowerCase()===table).columns;
 const meta=JSON.parse(row.__cells_json);
 change(meta[letter]);
 const cells=JSON.stringify(meta);
 const values=fields.map(f=>row[f]);
 const digest=hash(JSON.stringify([2,values,cells]));
 db.prepare('UPDATE "'+table+'" SET __cells_json=?,__row_sha256=? WHERE __excel_row=2').run(cells,digest);
}
test('complete verified archive yields only private Users and Roles in original physical order with unchanged source credentials',()=>{
 const db=fixture();
 try{
  const {snapshot,report}=extractPrivateLegacyStaffFromArchive(db);
  assert.deepEqual(Object.keys(snapshot),['users','roles']);
  assert.equal(snapshot.users.length,1);
  assert.equal(snapshot.roles.length,1);
  assert.deepEqual(Object.keys(snapshot.users[0]),schema.tables.find(t=>t.sheetKey==='USERS').columns);
  assert.equal(snapshot.users[0]['User ID'],sourceUser['User ID']);
  assert.equal(snapshot.users[0]['Password Hash'],sourceUser['Password Hash']);
  assert.equal(snapshot.users[0]['Password Salt'],sourceUser['Password Salt']);
  assert.equal(snapshot.users[0]['Created At'],'45658.5');
  assert.equal(snapshot.roles[0].Permissions,sourceRole.Permissions);
  assert.equal(JSON.stringify(snapshot).includes(secret),false);
  assert.equal(report.users,1);
  assert.equal(report.roles,1);
  assert.equal(report.verifiedArchivePhysicalRows,3);
  assert.equal(report.excludedLegacySessions,true);
  assert.equal(report.legacyStaffImportAuthorized,false);
  assert.equal(report.publicAuthenticationEnabled,false);
  assert.equal(report.spreadsheetTimezoneVerified,false);
  assert.doesNotMatch(JSON.stringify(report),/SYNTHETIC_PRIVATE|Password|017123/);
  const candidate=provisionallyConvertLegacyStaffExcelDates(snapshot,{workbookEpoch:1900,scriptTimeZone:'Asia/Dhaka'});
  assert.equal(candidate.snapshot.users[0]['Created At'],'2025-01-01T06:00:00.000Z');
  assert.equal(candidate.report.legacyStaffImportAuthorized,false);
 }finally{db.close();}
});
test('source date-cell numeric metadata must match original byte-text even after a forged but internally consistent row digest',()=>{
 for(const field of ['t','v','s']){
  const db=fixture();
  try{
   updateStaffMetadata(db,'legacy_users','I',entry=>{entry[field]=field==='t'?'s':field==='v'?'45658.4':''});
   assert.throws(()=>extractPrivateLegacyStaffFromArchive(db),/M04 private staff archive extraction rejected/);
  }finally{db.close();}
 }
});
test('source Role date-cell numeric metadata is mandatory; no fabricated source chronology',()=>{
 const db=fixture();
 try{
  updateStaffMetadata(db,'legacy_roles','F',entry=>{entry.v='45658.5'});
  assert.throws(()=>extractPrivateLegacyStaffFromArchive(db),/M04 private staff archive extraction rejected/);
 }finally{db.close();}
});
test('whole-archive row integrity failure rejects before private staff output',()=>{
 const db=fixture();
 try{
  // A tampered SESSIONS row also invalidates the original archive, even
  // though the extractor must never return its bearer token.
  db.exec("UPDATE legacy_sessions SET __row_sha256='bad' WHERE __excel_row=2");
  assert.throws(()=>extractPrivateLegacyStaffFromArchive(db),/M04 private staff archive extraction rejected/);
 }finally{db.close();}
});
test('unsupported raw source mobile remains unchanged for reviewer; no automatic truncation or fake phone',()=>{
 const db=fixture();
 try{
  const row=db.prepare('SELECT * FROM legacy_users WHERE __excel_row=2').get();
  const fields=schema.tables.find(t=>t.sheetKey==='USERS').columns;
  const values=fields.map(f=>f==='Mobile Number'?'123456':row[f]);
  db.prepare('UPDATE legacy_users SET "Mobile Number"=?,__row_sha256=? WHERE __excel_row=2')
    .run('123456',hash(JSON.stringify([2,values,row.__cells_json])));
  const r=extractPrivateLegacyStaffFromArchive(db);
  assert.equal(r.snapshot.users[0]['Mobile Number'],'123456');
  assert.equal(r.report.staffIdentityReconciled,false);
 }finally{db.close();}
});
test('invalid schemas, untrusted DB stubs and public runtime do not produce access to source Secrets',()=>{
 const db=new DatabaseSync(':memory:');
 try{assert.throws(()=>extractPrivateLegacyStaffFromArchive(db),/M04 private staff archive extraction rejected/);}
 finally{db.close();}
 assert.throws(()=>extractPrivateLegacyStaffFromArchive({prepare(){throw Error(secret)}}),e=>{
  assert.equal(e.message,'M04 private staff archive extraction rejected');return true;
 });
 const source=readFileSync(new URL('../src/auth/legacy-archive-staff-extract.js',import.meta.url),'utf8');
 const publicRuntime=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
  readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
 assert.doesNotMatch(source,/console\.|\bfetch\(|\bbatch\(|\bINSERT\b|\bUPDATE\b|\bDELETE\b/);
 assert.doesNotMatch(publicRuntime,/extractPrivateLegacyStaffFromArchive|legacy-archive-staff-extract/);
});