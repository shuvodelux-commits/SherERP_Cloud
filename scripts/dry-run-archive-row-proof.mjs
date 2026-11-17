#!/usr/bin/env node
/**
 * M02 offline original-source SQLite archive integrity gate.
 * Verifies all physical Excel rows and embedded original workbook chunks.
 * Never touches remote D1, exports source values, or authorizes migration.
 */
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {lstatSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {readFileSync} from 'node:fs';
import {planArchiveColumns} from './dry-run-archive-header-plan.mjs';

const INVENTORY=JSON.parse(readFileSync(new URL('../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const HEX=/^[a-f0-9]{64}$/;
const reject=()=>new Error('M02 private archive row integrity rejected');
const quote=x=>'"'+x.replaceAll('"','""')+'"';
const digest=data=>createHash('sha256').update(data).digest('hex');
const goodCount=x=>Number.isSafeInteger(x)&&x>=0;
const expectedPrefix=['__excel_row','__has_data','__cells_json','__row_sha256'];

/** DatabaseSync must be opened read-only by the caller; this function only SELECTs. */
export function verifyPrivateArchiveRows(db){
 try{
  if(!db||typeof db.prepare!=='function')throw reject();
  const sheets=db.prepare('SELECT sheet_key,sql_table,actual_headers_json,header_count,populated_data_rows,physical_data_rows FROM archive_sheets ORDER BY rowid').all();
  const plan=planArchiveColumns({schema:INVENTORY,sheets});
  if(sheets.length!==50)throw reject();
  let counted=0,populated=0;
  for(const sheet of sheets){
   const actual=JSON.parse(sheet.actual_headers_json);
   const name=sheet.sql_table;
   const columns=db.prepare('PRAGMA table_info('+quote(name)+')').all().map(x=>x.name);
   if(columns.length!==actual.length+4||
      columns.some((c,i)=>c!==(i<4?expectedPrefix[i]:actual[i-4])))
    throw reject();
   let groupTotal=0,groupPopulated=0,previousRow=1;
   const sql='SELECT '+columns.map(quote).join(',')+' FROM '+quote(name)+' ORDER BY __excel_row';
   for(const row of db.prepare(sql).iterate()){
    const values=actual.map(col=>row[col]);
    if(values.some(v=>v!==null&&typeof v!=='string')||
       !goodCount(row.__excel_row)||row.__excel_row<=previousRow||
       ![0,1].includes(row.__has_data)||
       typeof row.__cells_json!=='string'||
       typeof row.__row_sha256!=='string'||!HEX.test(row.__row_sha256))
     throw reject();
    const meta=JSON.parse(row.__cells_json);
    if(!meta||typeof meta!=='object'||Array.isArray(meta))throw reject();
    const hasData=values.some(v=>v!==null&&v!=='')?1:0;
    if(hasData!==row.__has_data)throw reject();
    const computed=digest(JSON.stringify([row.__excel_row,values,row.__cells_json]));
    if(computed!==row.__row_sha256)throw reject();
    previousRow=row.__excel_row;
    groupTotal++;
    groupPopulated+=hasData;
   }
   if(groupTotal!==sheet.physical_data_rows||
      groupPopulated!==sheet.populated_data_rows)throw reject();
   counted+=groupTotal;populated+=groupPopulated;
  }
  if(counted!==plan.physicalRows||populated!==plan.populatedRows)throw reject();

  const expected=db.prepare("SELECT value FROM archive_info WHERE key='original_xlsx_sha256'").get()?.value;
  if(typeof expected!=='string'||!HEX.test(expected))throw reject();
  const pieces=db.prepare('SELECT chunk_number,sha256,data FROM archive_source_parts ORDER BY chunk_number').all();
  if(pieces.length<1||pieces.length>200)throw reject();
  const h=createHash('sha256');
  let workbookBytes=0;
  for(let i=0;i<pieces.length;i++){
   const part=pieces[i];
   if(part.chunk_number!==i||typeof part.sha256!=='string'||
      !HEX.test(part.sha256)||!part.data||!ArrayBuffer.isView(part.data))throw reject();
   const bytes=Buffer.from(part.data);
   if(bytes.length<1||bytes.length>65536||digest(bytes)!==part.sha256)throw reject();
   workbookBytes+=bytes.length;
   if(workbookBytes>20*1024*1024)throw reject();
   h.update(bytes);
  }
  if(h.digest('hex')!==expected)throw reject();
  return Object.freeze({
   formatVersion:1,scope:'offline-private-archive-row-proof',
   sourceGroups:plan.sourceGroups,sheets:sheets.length,
   physicalRows:counted,populatedRows:populated,rowHashesVerified:counted,
   workbookParts:pieces.length,workbookBytes,workbookSha256Verified:true,
   exactGroups:plan.exactGroups,reorderOnlyGroups:plan.reorderOnlyGroups,
   reviewRequiredGroups:plan.reviewRequiredGroups,
   missingFrozenColumnCount:plan.missingFrozenColumnCount,
   unmappedExtraSourceColumnCount:plan.unmappedExtraSourceColumnCount,
   sourceHeaderMappingApproved:false,sourceIdentityReconciled:false,
   financialAccountsReconciled:false,remoteOperationalD1Reconciled:false,
   operationalImportAuthorized:false,staffAuthenticationEnabled:false,
   productionReady:false
  });
 }catch{throw reject();}
}

export function verifyPrivateArchivePath(input){
 let db;
 try{
  if(typeof input!=='string'||input.length<1||input.length>4096||
     input.startsWith('-')||/^[a-z][a-z0-9+.-]*:/i.test(input))throw reject();
  const path=resolve(input);
  const stat=lstatSync(path);
  if(!stat.isFile()||stat.size<1024||stat.size>200*1024*1024)throw reject();
  db=new DatabaseSync(path,{readOnly:true});
  db.exec('PRAGMA query_only=ON');
  return verifyPrivateArchiveRows(db);
 }catch{throw reject();}
 finally{if(db)db.close();}
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const [mode,filename]=process.argv.slice(2);
  if(process.argv.length!==4||!['--report','--require-lossless'].includes(mode))throw reject();
  const report=verifyPrivateArchivePath(filename);
  process.stdout.write(JSON.stringify(report,null,2)+'\n');
  if(mode==='--require-lossless'&&report.reviewRequiredGroups>0)process.exitCode=2;
 }catch{
  process.stderr.write('M02 private archive row integrity rejected (private values withheld)\n');
  process.exitCode=2;
 }
}
