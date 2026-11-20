/**
 * M10 offline-only materialized recovery drill. All records are fabricated.
 * Never points at a Worker, remote D1, real exports or customer records.
 */
import {DatabaseSync, backup} from 'node:sqlite';
import {mkdtemp, copyFile, rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const ERROR='M10 synthetic recovery rehearsal rejected';
const inventory=JSON.parse(readFileSync(new URL('../../docs/baseline/schema-inventory.json', import.meta.url),'utf8'));
const keys=inventory.tables.map(({sheetKey})=>sheetKey);
if(keys.length!==49||new Set(keys).size!==49||!keys.includes('LOGS'))throw new Error(ERROR);
const faults=new Set([null,'first-missing','replay-tamper','backup-missing',
  'restore-missing','restore-tamper','restore-id-drift','restore-log-position',
  'restore-extra']);
const source=keys.flatMap((sheetKey,index)=>[2,4].map(position=>({
  sheetKey,position,sourceId:sheetKey==='LOGS'?null:`SYNTH-${sheetKey}-${position}`,
  payload:JSON.stringify({synthetic:true,groupOrdinal:index,position,
    phoneText:'01700000000',dateText:'2026-11-20',amountText:'000123.4500',
    deleted:position===4,unitText:'BOX|PCS|SQFT'})
})));
function openDatabase(path){
  const db=new DatabaseSync(path);
  db.exec(`CREATE TABLE IF NOT EXISTS m10_synthetic_rows (
    sheet_key TEXT NOT NULL, source_position INTEGER NOT NULL,
    source_id TEXT, source_payload TEXT NOT NULL,
    PRIMARY KEY(sheet_key,source_position),
    UNIQUE(sheet_key,source_id)
  )`);
  return db;
}
function allRows(db){
  return db.prepare(`SELECT sheet_key,source_position,source_id,source_payload
    FROM m10_synthetic_rows ORDER BY sheet_key,source_position`).all()
    .map(row=>({sheetKey:row.sheet_key,position:row.source_position,
      sourceId:row.source_id,payload:row.source_payload}));
}
function apply(db,rows){
  const read=db.prepare(`SELECT source_id,source_payload FROM m10_synthetic_rows
    WHERE sheet_key=? AND source_position=?`);
  const write=db.prepare(`INSERT INTO m10_synthetic_rows
    (sheet_key,source_position,source_id,source_payload) VALUES(?,?,?,?)`);
  db.exec('BEGIN IMMEDIATE');
  try{
    for(const row of rows){
      const old=read.get(row.sheetKey,row.position);
      if(old){
        if(old.source_id!==row.sourceId||old.source_payload!==row.payload)
          throw new Error(ERROR);
      }else write.run(row.sheetKey,row.position,row.sourceId,row.payload);
    }
    db.exec('COMMIT');
  }catch{
    db.exec('ROLLBACK');
    throw new Error(ERROR);
  }
}
function verify(actual,stage,add){
  const expected=new Map(source.map(row=>[`${row.sheetKey}|${row.position}`,row]));
  const observed=new Map();
  const present=new Set();
  for(const row of actual){
    const id=`${row.sheetKey}|${row.position}`;
    if(observed.has(id)){add(`${stage}_DUPLICATE_ROW`);continue;}
    observed.set(id,row);present.add(row.sheetKey);
    const prior=expected.get(id);
    if(!prior){add(`${stage}_EXTRA_ROW`);continue;}
    if(prior.sourceId!==row.sourceId)add(`${stage}_SOURCE_ID_MISMATCH`);
    if(prior.payload!==row.payload)add(`${stage}_CONTENT_MISMATCH`);
  }
  for(const row of source)if(!observed.has(`${row.sheetKey}|${row.position}`))
    add(`${stage}_MISSING_ROW`);
  for(const key of keys)if(!present.has(key))add(`${stage}_MISSING_GROUP`);
}
function removeOne(db,key=keys[0]){
  db.prepare('DELETE FROM m10_synthetic_rows WHERE sheet_key=? AND source_position=2').run(key);
}
function corrupt(db,fault){
  if(fault==='first-missing'||fault==='backup-missing'||fault==='restore-missing')
    removeOne(db);
  else if(fault==='replay-tamper'||fault==='restore-tamper')
    db.prepare('UPDATE m10_synthetic_rows SET source_payload=? WHERE sheet_key=? AND source_position=2')
      .run('{"synthetic":true,"tampered":true}',keys[0]);
  else if(fault==='restore-id-drift')
    db.prepare('UPDATE m10_synthetic_rows SET source_id=? WHERE sheet_key=? AND source_position=2')
      .run('SYNTH-WRONG-ID',keys[0]);
  else if(fault==='restore-log-position')
    db.prepare('UPDATE m10_synthetic_rows SET source_position=3 WHERE sheet_key=? AND source_position=2')
      .run('LOGS');
  else if(fault==='restore-extra')
    db.prepare('INSERT INTO m10_synthetic_rows VALUES(?,?,?,?)')
      .run(keys[0],99,'SYNTH-EXTRA','{"synthetic":true}');
}
/** Run only fabricated 49-group data in disposable local SQLite files. */
export async function runM10SyntheticSqliteRecovery({fault=null}={}){
  if(!faults.has(fault))throw new Error(ERROR);
  const issues=new Map();
  const add=code=>issues.set(code,(issues.get(code)||0)+1);
  let dir,db;
  try{
    dir=await mkdtemp(join(tmpdir(),'m10-synthetic-recovery-'));
    db=openDatabase(':memory:');
    apply(db,source);
    if(fault==='first-missing')corrupt(db,fault);
    verify(allRows(db),'FIRST',add);
    apply(db,source);
    if(fault==='replay-tamper')corrupt(db,fault);
    verify(allRows(db),'REPLAY',add);
    const before=allRows(db);
    let rejected=false;
    try{
      apply(db,[{...source[0],position:999,sourceId:'SYNTH-ROLLBACK-PROBE'},
        {...source[0],payload:'{"synthetic":true,"changedIntent":true}'}]);
    }catch{rejected=true;}
    if(!rejected)add('RETRY_CONFLICT_NOT_REJECTED');
    const after=allRows(db);
    if(JSON.stringify(after)!==JSON.stringify(before))add('RETRY_ROLLBACK_FAILED');
    verify(after,'REJECTED_RETRY',add);
    const backupPath=join(dir,'backup.sqlite');
    await backup(db,backupPath);
    db.close(); db=null;
    let saved=openDatabase(backupPath);
    try{
      if(fault==='backup-missing')corrupt(saved,fault);
      verify(allRows(saved),'BACKUP',add);
    }finally{saved.close();}
    const restoredPath=join(dir,'restored.sqlite');
    await copyFile(backupPath,restoredPath);
    let restored=openDatabase(restoredPath);
    try{
      if(fault?.startsWith('restore-'))corrupt(restored,fault);
      verify(allRows(restored),'RESTORE',add);
    }finally{restored.close();}
    const ordered=[...issues].sort(([a],[b])=>a.localeCompare(b))
      .map(([code,count])=>({code,count}));
    return {
      formatVersion:1,phase:'M10_LOCAL_SYNTHETIC_SQLITE_RECOVERY',
      groupsExpected:49,rowsExpected:source.length,
      candidateSyntheticRehearsal:ordered.length===0,
      authorizesRealImport:false,authorizesRemoteD1Write:false,
      authorizesRestore:false,productionReady:false,
      issues:ordered,
      limitations:'Disposable synthetic SQLite is not Cloudflare D1, real source reconciliation, authenticated backup custody or production approval'
    };
  }catch{
    throw new Error(ERROR);
  }finally{
    try{db?.close();}catch{}
    if(dir)await rm(dir,{recursive:true,force:true});
  }
}
