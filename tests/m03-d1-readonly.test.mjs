import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createCatalogReader } from '../src/db/read-only-catalog.js';
import { resolveLegacyPartyId } from '../src/db/party-identity-read.js';

const setup = () => {
  const db=new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE product_categories(row_id INTEGER PRIMARY KEY,category_id TEXT,category_name TEXT,status TEXT);
    CREATE TABLE product_units(row_id INTEGER PRIMARY KEY,unit_id TEXT,unit_name TEXT,status TEXT);
    CREATE TABLE party_legacy_links(link_id INTEGER PRIMARY KEY,source_group TEXT,source_id TEXT,party_id TEXT,status TEXT);
    INSERT INTO product_categories VALUES (1,'CAT-1','Electrical','Active'),(2,'CAT-2','দড়ি','Inactive');
    INSERT INTO product_units VALUES (1,'UNIT-1','Pcs','Active'),(2,'UNIT-2','Feet','Active');
    INSERT INTO party_legacy_links VALUES (1,'CUSTOMERS','CUS-1','PARTY-1','ACTIVE'),(2,'SUPPLIERS','SUP-1','PARTY-1','ACTIVE'),(3,'VENDORS','VEN-1','PARTY-2','RETIRED');
  `);
  const observed=[];
  const binding={prepare(sql){
    observed.push(sql);
    const stmt=db.prepare(sql);
    return {bind(...values){return {
      async all(){return {success:true,results:stmt.all(...values)};},
      async first(){return stmt.get(...values)??null;}
    };}};
  }};
  return {db,observed,env:{DB:binding}};
};

test('requires explicit D1 binding; never silently falls back to local or preview state',async()=>{
  assert.throws(()=>createCatalogReader({}),/D1|binding/i);
  assert.throws(()=>createCatalogReader({DB:{}}),/D1|binding/i);
  await assert.rejects(()=>resolveLegacyPartyId({},'CUSTOMERS','CUS-1'),/D1|binding/i);
});

test('reads catalog masters in original stable row order with bounded parameterized LIMIT',async()=>{
  const t=setup();try{
    const repo=createCatalogReader(t.env);
    assert.deepEqual(await repo.listCategories(1),[{category_id:'CAT-1',category_name:'Electrical',status:'Active'}]);
    assert.deepEqual(await repo.listCategories(5),[
      {category_id:'CAT-1',category_name:'Electrical',status:'Active'},
      {category_id:'CAT-2',category_name:'দড়ি',status:'Inactive'}
    ]);
    assert.deepEqual(await repo.listUnits(2),[
      {unit_id:'UNIT-1',unit_name:'Pcs',status:'Active'},
      {unit_id:'UNIT-2',unit_name:'Feet',status:'Active'}
    ]);
    assert(t.observed.every(sql=>/^SELECT\b/i.test(sql.trim())));
    assert(t.observed.every(sql=>/\bLIMIT\s+\?/i.test(sql)));
    assert(t.observed.every(sql=>!sql.includes('settings')));
  }finally{t.db.close();}
});

test('rejects invalid limits and forged result payloads; no SQL injection or unbounded scans',async()=>{
  const t=setup();try{
    const r=createCatalogReader(t.env);
    for(const bad of [0,-1,101,'5','1; DROP TABLE parties',2.5,Infinity,null]){
      await assert.rejects(()=>r.listCategories(bad),/limit/i);
    }
    assert.deepEqual(await r.listCategories(),[
      {category_id:'CAT-1',category_name:'Electrical',status:'Active'},
      {category_id:'CAT-2',category_name:'দড়ি',status:'Inactive'}
    ]);
  }finally{t.db.close();}
  const bad={DB:{prepare:()=>({bind:()=>({all:async()=>({success:false,results:[]})})})}};
  await assert.rejects(()=>createCatalogReader(bad).listCategories(),/D1|result/i);
});

test('Party lookup uses exact legacy group and source ID; never guesses by name/phone',async()=>{
  const t=setup();try{
    assert.equal(await resolveLegacyPartyId(t.env,'CUSTOMERS','CUS-1'),'PARTY-1');
    assert.equal(await resolveLegacyPartyId(t.env,'SUPPLIERS','SUP-1'),'PARTY-1');
    assert.equal(await resolveLegacyPartyId(t.env,'VENDORS','VEN-1'),null);
    assert.equal(await resolveLegacyPartyId(t.env,'CUSTOMERS','cus-1'),null);
    assert.equal(await resolveLegacyPartyId(t.env,'CUSTOMERS',"CUS-1' OR 1=1 --"),null);
    assert(t.observed.every(s=>/^SELECT\b/i.test(s.trim())));
    assert(t.observed.some(s=>/source_group\s*=\s*\?\s+AND\s+source_id\s*=\s*\?/i.test(s)));
  }finally{t.db.close();}
});

test('rejects unknown Party source groups, blank legacy IDs and invalid D1 results',async()=>{
  const t=setup();try{
    for(const bad of ['USERS','parties',"CUSTOMERS' OR 1=1",'']){
      await assert.rejects(()=>resolveLegacyPartyId(t.env,bad,'CUS-1'),/source group/i);
    }
    for(const bad of ['', '   ',null,7]){
      await assert.rejects(()=>resolveLegacyPartyId(t.env,'CUSTOMERS',bad),/source ID/i);
    }
  }finally{t.db.close();}
  const bad={DB:{prepare:()=>({bind:()=>({first:async()=>({party_id:5})})})}};
  await assert.rejects(()=>resolveLegacyPartyId(bad,'CUSTOMERS','CUS-1'),/Party|identity|result/i);
});
