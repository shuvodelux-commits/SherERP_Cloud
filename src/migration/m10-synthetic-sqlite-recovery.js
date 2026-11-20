/**
 * M10 offline-only materialized recovery drill. All records are fabricated.
 * Never points at a Worker, remote D1, real exports or customer records.
 */
import {DatabaseSync, backup} from 'node:sqlite';
import {mkdtemp, copyFile, writeFile, rm} from 'node:fs/promises';
import {readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const ERROR='M10 synthetic recovery rehearsal rejected';
const inventory=JSON.parse(readFileSync(new URL('../../docs/baseline/schema-inventory.json', import.meta.url),'utf8'));
const keys=inventory.tables.map(({sheetKey})=>sheetKey);
if(keys.length!==49||new Set(keys).size!==49||!keys.includes('LOGS'))throw new Error(ERROR);
const faults=new Set([null,'first-missing','replay-tamper','backup-missing',
  'restore-missing','restore-tamper','restore-id-drift','restore-log-position',
  'restore-extra','backup-schema-drift','restore-schema-drift',
  'restore-extra-table','restore-schema-version',
  'backup-corrupt-header','restore-corrupt-header']);
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
// Snapshot physical SQLite schema as well as row content: a data-only
// readback can pass after UNIQUE constraints or other schema objects vanish.
function readStructure(db){
  return JSON.stringify({
    objects:db.prepare(`SELECT type,name,tbl_name,sql FROM sqlite_schema
      WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name`).all(),
    columns:db.prepare('PRAGMA table_info(m10_synthetic_rows)').all(),
    indexes:db.prepare('PRAGMA index_list(m10_synthetic_rows)').all(),
    foreignKeys:db.prepare('PRAGMA foreign_key_list(m10_synthetic_rows)').all(),
    userVersion:db.prepare('PRAGMA user_version').get(),
    applicationId:db.prepare('PRAGMA application_id').get()
  });
}
function verifyStructure(db,stage,expected,add){
  try{
    const integrity=db.prepare('PRAGMA integrity_check').all();
    if(integrity.length!==1||Object.values(integrity[0])[0]!=='ok')
      add(`${stage}_INTEGRITY_FAILURE`);
    if(db.prepare('PRAGMA foreign_key_check').all().length)
      add(`${stage}_FOREIGN_KEY_FAILURE`);
    if(readStructure(db)!==expected)add(`${stage}_SCHEMA_MISMATCH`);

    // Actual SQL-enforced uniqueness, not just a metadata claim. The two
    // synthetic rows use different PK positions but the same source ID.
    // The SAVEPOINT is always rolled back, including when the second INSERT
    // unexpectedly succeeds because the UNIQUE constraint was dropped.
    db.exec('SAVEPOINT m10_unique_probe');
    try{
      const insert=db.prepare(`INSERT INTO m10_synthetic_rows
        (sheet_key,source_position,source_id,source_payload)
        VALUES(?,?,?,?)`);
      insert.run(keys[0],7777,'SYNTH-UNIQUE-PROBE','{}');
      let duplicateBlocked=false;
      try{insert.run(keys[0],7778,'SYNTH-UNIQUE-PROBE','{}');}
      catch{duplicateBlocked=true;}
      if(!duplicateBlocked)add(`${stage}_UNIQUE_CONSTRAINT_LOST`);
    }finally{
      db.exec('ROLLBACK TO SAVEPOINT m10_unique_probe');
      db.exec('RELEASE SAVEPOINT m10_unique_probe');
    }
  }catch{
    add(`${stage}_INTEGRITY_FAILURE`);
  }
}
function rebuildWithoutSourceIdUnique(db){
  // Keep all 98 values and the position PK, but silently drop source-ID
  // uniqueness. This is an intentionally damaged disposable fixture.
  db.exec(`BEGIN IMMEDIATE;
    CREATE TABLE m10_synthetic_rebuild AS
      SELECT * FROM m10_synthetic_rows;
    DROP TABLE m10_synthetic_rows;
    CREATE TABLE m10_synthetic_rows (
      sheet_key TEXT NOT NULL, source_position INTEGER NOT NULL,
      source_id TEXT, source_payload TEXT NOT NULL,
      PRIMARY KEY(sheet_key,source_position)
    );
    INSERT INTO m10_synthetic_rows
      (sheet_key,source_position,source_id,source_payload)
    SELECT sheet_key,source_position,source_id,source_payload
      FROM m10_synthetic_rebuild;
    DROP TABLE m10_synthetic_rebuild;
    COMMIT;`);
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
  else if(fault==='backup-schema-drift'||fault==='restore-schema-drift')
    rebuildWithoutSourceIdUnique(db);
  else if(fault==='restore-extra-table')
    db.exec('CREATE TABLE m10_unexpected_schema_object(id TEXT)');
  else if(fault==='restore-schema-version')
    db.exec('PRAGMA user_version=12345');
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
    const baselineStructure=readStructure(db);
    apply(db,source);
    if(fault==='first-missing')corrupt(db,fault);
    verify(allRows(db),'FIRST',add);
    verifyStructure(db,'FIRST',baselineStructure,add);
    apply(db,source);
    if(fault==='replay-tamper')corrupt(db,fault);
    verify(allRows(db),'REPLAY',add);
    verifyStructure(db,'REPLAY',baselineStructure,add);
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
    if(fault==='backup-corrupt-header')
      await writeFile(backupPath,'NOT-SQLITE-TEST-ONLY');
    let saved=openDatabase(backupPath);
    try{
      if(fault==='backup-missing'||fault==='backup-schema-drift')
        corrupt(saved,fault);
      verify(allRows(saved),'BACKUP',add);
      verifyStructure(saved,'BACKUP',baselineStructure,add);
    }finally{saved.close();}
    const restoredPath=join(dir,'restored.sqlite');
    await copyFile(backupPath,restoredPath);
    if(fault==='restore-corrupt-header')
      await writeFile(restoredPath,'NOT-SQLITE-TEST-ONLY');
    let restored=openDatabase(restoredPath);
    try{
      if(fault?.startsWith('restore-'))corrupt(restored,fault);
      verify(allRows(restored),'RESTORE',add);
      verifyStructure(restored,'RESTORE',baselineStructure,add);
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
