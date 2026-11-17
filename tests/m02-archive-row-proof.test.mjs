import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {mkdtempSync,symlinkSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {verifyPrivateArchiveRows,verifyPrivateArchivePath} from '../scripts/dry-run-archive-row-proof.mjs';

const schema=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const secret='SYNTHETIC_PRIVATE_PHONE_01712345678';
const hash=x=>createHash('sha256').update(x).digest('hex');
const quote=x=>'"'+x.replaceAll('"','""')+'"';
function fixture({reorder=false,extra=false}={}){
 const folder=mkdtempSync(join(tmpdir(),'m02-source-row-'));
 const path=join(folder,'private.sqlite');
 const db=new DatabaseSync(path);
 db.exec('CREATE TABLE archive_sheets(sheet_key TEXT,sql_table TEXT,actual_headers_json TEXT,header_count INTEGER,populated_data_rows INTEGER,physical_data_rows INTEGER)');
 db.exec('CREATE TABLE archive_source_parts(chunk_number INTEGER PRIMARY KEY,sha256 TEXT,data BLOB)');
 db.exec('CREATE TABLE archive_info(key TEXT PRIMARY KEY,value TEXT NOT NULL)');
 const chunk=Buffer.from('SYNTHETIC_WORKBOOK_BYTES');
 db.prepare('INSERT INTO archive_source_parts VALUES (?,?,?)').run(0,hash(chunk),chunk);
 db.prepare('INSERT INTO archive_info VALUES (?,?)').run('original_xlsx_sha256',hash(chunk));
 for(const [i,sheet] of schema.tables.entries()){
  const cols=[...sheet.columns];
  if(i===0&&reorder)cols.reverse();
  if(i===0&&extra)cols.push('Conversion Unit','Conversion Factor');
  const table='legacy_'+sheet.sheetKey.toLowerCase();
  db.exec('CREATE TABLE '+quote(table)+' (__excel_row INTEGER PRIMARY KEY,__has_data INTEGER,__cells_json TEXT,__row_sha256 TEXT,'+cols.map(c=>quote(c)+' TEXT').join(',')+')');
  db.prepare('INSERT INTO archive_sheets VALUES (?,?,?,?,?,?)').run(sheet.sheetKey,table,JSON.stringify(cols),cols.length,1,2);
  const insert=db.prepare('INSERT INTO '+quote(table)+' VALUES ('+Array(cols.length+4).fill('?').join(',')+')');
  for(const n of [2,3]){
   const values=cols.map((_,j)=>n===2&&j===0?secret:null);
   insert.run(n,n===2?1:0,'{}',hash(JSON.stringify([n,values,'{}'])),...values);
  }
 }
 db.exec('CREATE TABLE legacy_sheet1 (__excel_row INTEGER PRIMARY KEY,__has_data INTEGER,__cells_json TEXT,__row_sha256 TEXT)');
 db.prepare('INSERT INTO archive_sheets VALUES (?,?,?,?,?,?)').run('SHEET1','legacy_sheet1','[]',0,0,0);
 db.close();
 return {path,folder};
}
function release(f){rmSync(f.folder,{recursive:true,force:true});}
test('entire 49-group synthetic archive validates all row SHA and workbook chunk hashes',()=>{
 const f=fixture();try{
  const r=verifyPrivateArchivePath(f.path);
  assert.equal(r.sourceGroups,49);
  assert.equal(r.sheets,50);
  assert.equal(r.physicalRows,98);
  assert.equal(r.populatedRows,49);
  assert.equal(r.rowHashesVerified,98);
  assert.equal(r.exactGroups,49);
  assert.equal(r.workbookParts,1);
  assert.equal(r.workbookSha256Verified,true);
  assert.equal(r.operationalImportAuthorized,false);
  assert.equal(r.staffAuthenticationEnabled,false);
  assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC_PRIVATE_PHONE/);
 }finally{release(f);}
});
test('source column order changes do not alter row hashes',()=>{
 const f=fixture({reorder:true});try{
  const r=verifyPrivateArchivePath(f.path);
  assert.equal(r.reorderOnlyGroups,1);
  assert.equal(r.reviewRequiredGroups,0);
  assert.equal(r.rowHashesVerified,98);
 }finally{release(f);}
});
test('extra original conversion columns are retained but never approved for projection',()=>{
 const f=fixture({extra:true});try{
  const r=verifyPrivateArchivePath(f.path);
  assert.equal(r.reviewRequiredGroups,1);
  assert.equal(r.unmappedExtraSourceColumnCount,2);
  assert.equal(r.sourceHeaderMappingApproved,false);
 }finally{release(f);}
});
test('tampering with cell text, cell metadata or source digest fails closed',()=>{
 const alterations=[
  'UPDATE legacy_products SET "Product ID" = "UNAUTHORIZED_CHANGE" WHERE __excel_row=2',
  "UPDATE legacy_products SET __cells_json = '{ }' WHERE __excel_row=2",
  "UPDATE legacy_products SET __row_sha256 = '0' WHERE __excel_row=2"
 ];
 for(const sql of alterations){const f=fixture();try{
  const db=new DatabaseSync(f.path);db.exec(sql);db.close();
  assert.throws(()=>verifyPrivateArchivePath(f.path),/archive row integrity rejected/i);
 }finally{release(f);}}
});
test('count, populated flag, workbook digest and metadata table forgery fail closed',()=>{
 const changes=[
  "UPDATE archive_sheets SET physical_data_rows=111 WHERE sheet_key='PRODUCTS'",
  "UPDATE legacy_products SET __has_data=0 WHERE __excel_row=2",
  "UPDATE archive_source_parts SET sha256='bad' WHERE chunk_number=0",
  "UPDATE archive_info SET value='bad' WHERE key='original_xlsx_sha256'",
  "UPDATE archive_sheets SET sql_table='legacy_invalid' WHERE sheet_key='PRODUCTS'"
 ];
 for(const sql of changes){const f=fixture();try{
  const db=new DatabaseSync(f.path);db.exec(sql);db.close();
  assert.throws(()=>verifyPrivateArchivePath(f.path),/archive row integrity rejected/i);
 }finally{release(f);}}
});
test('read-only connection verifies source and incomplete SQLite fails closed',()=>{
 const f=fixture();try{
  const db=new DatabaseSync(f.path,{readOnly:true});
  assert.equal(verifyPrivateArchiveRows(db).rowHashesVerified,98);
  db.close();
  const bad=new DatabaseSync(':memory:');
  assert.throws(()=>verifyPrivateArchiveRows(bad),/archive row integrity rejected/i);
  bad.close();
 }finally{release(f);}
});
test('CLI strict gate blocks unmapped historical source fields and never prints private cells',()=>{
 const f=fixture({extra:true});try{
  const cli=new URL('../scripts/dry-run-archive-row-proof.mjs',import.meta.url).pathname;
  const r=spawnSync(process.execPath,[cli,'--require-lossless',f.path],{encoding:'utf8'});
  assert.equal(r.status,2,r.stderr);
  assert.equal(JSON.parse(r.stdout).rowHashesVerified,98);
  const link=join(f.folder,'linked.sqlite');symlinkSync(f.path,link);
  const denied=spawnSync(process.execPath,[cli,'--report',link],{encoding:'utf8'});
  assert.equal(denied.status,2);
  assert.doesNotMatch(r.stdout+r.stderr+denied.stdout+denied.stderr,/SYNTHETIC_PRIVATE_PHONE|01712345678/);
 }finally{release(f);}
});