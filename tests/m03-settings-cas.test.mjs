import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {createSettingsReadAdapter} from '../src/db/settings-read.js';
import {createGuardedShellSettingsUpdateAdapter} from '../src/db/settings-update.js';

const DDL=readFileSync(new URL('../migrations/0001_core_catalog.sql',import.meta.url),'utf8');

function fixture(){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(DDL);
  sqlite.exec("INSERT INTO settings(key,value,legacy_sheet_row) VALUES"+
    "('Shop Name','Original Shop',2),"+
    "('Currency Symbol','৳',3),"+
    "('Phone 1','01712345678',4),"+
    "('Delete Confirmation Key','PRIVATE',5)");
  const sqls=[];
  const DB={prepare(sql){
    sqls.push(sql);
    const stmt=sqlite.prepare(sql);
    return {bind(...args){return {
      async first(){return stmt.get(...args)??null;},
      async all(){return {success:true,results:stmt.all(...args)};}
    }}};
  }};
  return {
    sqlite,DB,sqls,
    update:createGuardedShellSettingsUpdateAdapter({DB}),
    read:createSettingsReadAdapter({DB}),
    close:()=>sqlite.close()
  };
}
function rows(db){
  return db.prepare('SELECT key,value,row_id,legacy_sheet_row FROM settings ORDER BY row_id')
    .all().map(row=>({...row}));
}

test('guarded update trims source Shop Name and preserves original row identity',async()=>{
  const f=fixture();
  try{
    const before=rows(f.sqlite);
    assert.deepEqual(await f.update.updateExisting_('Shop Name','  নবাবী হার্ডওয়্যার  ','Original Shop'),{updated:true});
    const after=rows(f.sqlite);
    assert.deepEqual(after[0],{...before[0],value:'নবাবী হার্ডওয়্যার'});
    assert.deepEqual(after.slice(1),before.slice(1));
    assert.equal((await f.read.getAppShellSettings_()).shopName,'নবাবী হার্ডওয়্যার');
    assert.equal(f.sqls.filter(sql=>sql.startsWith('UPDATE settings')).length,1);
  }finally{f.close();}
});

test('Currency Symbol permits blank and Unicode without changing unrelated Settings',async()=>{
  const f=fixture();
  try{
    assert.deepEqual(await f.update.updateExisting_('Currency Symbol','  ৳  ','৳'),{updated:true});
    assert.deepEqual(await f.update.updateExisting_('Currency Symbol',' ','৳'),{updated:true});
    assert.deepEqual(await f.read.getAppShellSettings_(),{
      shopName:'Original Shop',currencySymbol:''
    });
    assert.equal(rows(f.sqlite).find(row=>row.key==='Phone 1').value,'01712345678');
  }finally{f.close();}
});

test('missing key is an explicit conflict and cannot silently create a new row',async()=>{
  const f=fixture();
  try{
    f.sqlite.exec("DELETE FROM settings WHERE key='Shop Name'");
    const before=rows(f.sqlite);
    await assert.rejects(()=>f.update.updateExisting_('Shop Name','New Shop','Original Shop'),
      /stale|missing|conflict/i);
    assert.deepEqual(rows(f.sqlite),before);
  }finally{f.close();}
});

test('changed preimage cannot overwrite an administrator newer value',async()=>{
  const f=fixture();
  try{
    await f.update.updateExisting_('Shop Name','Latest','Original Shop');
    const before=rows(f.sqlite);
    await assert.rejects(()=>f.update.updateExisting_('Shop Name','Stale write','Original Shop'),
      /stale|missing|conflict/i);
    assert.deepEqual(rows(f.sqlite),before);
  }finally{f.close();}
});

test('two competing same-preimage updates commit at most one value',async()=>{
  const f=fixture();
  try{
    const results=await Promise.allSettled([
      f.update.updateExisting_('Shop Name','First','Original Shop'),
      f.update.updateExisting_('Shop Name','Second','Original Shop')
    ]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(results.filter(r=>r.status==='rejected').length,1);
    assert.equal(rows(f.sqlite)[0].value,results[0].status==='fulfilled'?'First':'Second');
    assert.equal(rows(f.sqlite).length,4);
  }finally{f.close();}
});

test('same-value update is a permitted single-row no-op, preserving source index',async()=>{
  const f=fixture();
  try{
    const before=rows(f.sqlite);
    assert.deepEqual(await f.update.updateExisting_('Shop Name',' Original Shop ','Original Shop'),{updated:true});
    assert.deepEqual(rows(f.sqlite),before);
  }finally{f.close();}
});

test('strict allowlist refuses private keys, unknown sheets and invalid values before D1',async()=>{
  const f=fixture();
  try{
    const bad=[
      ['Phone 1','01999999999','01712345678'],
      ['Delete Confirmation Key','WEAK','PRIVATE'],
      ['Invoice Logo','malware',''],
      ['__proto__','pwn',''],
      ['Currency Symbol',123,'৳'],
      ['Shop Name','   ','Original Shop'],
      ['Shop Name',null,'Original Shop'],
      ['Shop Name','New',null],
      ['Shop Name','New',undefined],
      [null,'New','Original Shop']
    ];
    for(const args of bad){
      await assert.rejects(()=>f.update.updateExisting_(...args),/invalid|unsupported|required|preimage|key/i);
    }
    assert.equal(f.sqls.length,0,'invalid request never prepares a statement');
    assert.equal(rows(f.sqlite).find(row=>row.key==='Delete Confirmation Key').value,'PRIVATE');
  }finally{f.close();}
});

test('D1 update is bound SQL, not dynamic identifiers or injected key/value',async()=>{
  const f=fixture();
  try{
    const suspicious="৳'); DELETE FROM settings; --";
    await f.update.updateExisting_('Currency Symbol',suspicious,'৳');
    assert.equal(rows(f.sqlite).find(row=>row.key==='Currency Symbol').value,suspicious);
    assert.equal(rows(f.sqlite).length,4);
    const statement=f.sqls[0];
    assert.match(statement,/UPDATE settings SET value=\?/);
    assert.match(statement,/WHERE key=\? AND value=\?/);
    assert.match(statement,/RETURNING key,value/);
    assert.equal(statement.includes(suspicious),false);
  }finally{f.close();}
});

test('missing binding and malformed/ambiguous D1 results never claim success',async()=>{
  assert.throws(()=>createGuardedShellSettingsUpdateAdapter({}),/D1|binding/i);
  const malformed=[undefined,{},[],{key:'Shop Name',value:'FORGED'},
    {key:'Other',value:'New'}, {key:'Shop Name',value:99}];
  for(const row of malformed){
    const DB={prepare(){return {bind(){return {first:async()=>row}}}}};
    await assert.rejects(()=>createGuardedShellSettingsUpdateAdapter({DB})
      .updateExisting_('Shop Name','New','Old'),/NEEDS_REVIEW/i);
  }
  const DB={prepare(){throw Error('Lost D1 response')}};
  await assert.rejects(()=>createGuardedShellSettingsUpdateAdapter({DB})
    .updateExisting_('Shop Name','New','Old'),/NEEDS_REVIEW/i);
});

test('normal D1 absence is a stale conflict, never a silent success or automatic insert',async()=>{
  const DB={prepare(){return {bind(){return {first:async()=>null}}}}};
  await assert.rejects(()=>createGuardedShellSettingsUpdateAdapter({DB})
    .updateExisting_('Shop Name','New','Old'),/stale|missing|conflict/i);
});
