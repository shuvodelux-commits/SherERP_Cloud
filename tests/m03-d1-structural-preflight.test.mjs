import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {verifyM03D1FoundationSchema} from '../src/db/d1-schema-preflight.js';

const MIGRATIONS=[
  '0001_core_catalog.sql','0002_party_identity.sql',
  '0012_legacy_product_snapshots.sql','0013_product_catalog_revisions.sql',
  '0014_tile_measurement_revisions.sql'
];
function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  for(const name of MIGRATIONS){
    sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'));
  }
  const statements=[];
  const wrap=(transform=(query,rows)=>rows)=>({
    DB:{prepare(query){
      statements.push(query);
      const prepared=sql.prepare(query);
      return {async all(){return {success:true,results:transform(query,prepared.all().map(x=>({...x})))};}};
    }}
  });
  return {sql,statements,wrap,close:()=>sql.close()};
}

test('M03 reads only fixed local D1 schema metadata across core catalog, Party, products, Units and tiles',async()=>{
  const x=fixture();try{
    assert.deepEqual(await verifyM03D1FoundationSchema(x.wrap()),{
      scope:'read-only-structural-metadata',status:'STRUCTURAL_ONLY',
      requiredTables:13,requiredColumns:65
    });
    assert.equal(x.statements.length,14);
    assert.equal(x.statements[0],'PRAGMA table_list');
    assert(x.statements.slice(1).every(sql=>/^PRAGMA table_info\('[a-z_]+?'\)$/.test(sql)),
      'Only a fixed allowlist of PRAGMA table_info statements is permitted');
    assert(x.statements.every(query=>!query.includes('SELECT *') && !/INSERT |UPDATE |DELETE /i.test(query)));
  }finally{x.close();}
});

test('M03 additive reviewed columns do not invalidate existing repository read contracts',async()=>{
  const x=fixture();try{
    x.sql.exec('ALTER TABLE settings ADD COLUMN future_reviewed_field TEXT');
    assert.deepEqual(await verifyM03D1FoundationSchema(x.wrap()),{
      scope:'read-only-structural-metadata',status:'STRUCTURAL_ONLY',
      requiredTables:13,requiredColumns:65
    });
  }finally{x.close();}
});

test('M03 missing required legacy physical row, product revision or tile dimensions fails before repository use',async()=>{
  const x=fixture();try{
    for(const [table,column] of [
      ['party_legacy_links','legacy_sheet_row'],
      ['product_unit_conversions','factor_text'],
      ['product_tile_measurement_revisions','pieces_per_box'],
      ['product_categories','category_id']
    ]){
      const f=(query,rows)=>query===`PRAGMA table_info('${table}')`?
        rows.filter(r=>r.name!==column):rows;
      await assert.rejects(()=>verifyM03D1FoundationSchema(x.wrap(f)),
        /NEEDS_REVIEW|D1.*schema|incompatible/i);
    }
  }finally{x.close();}
});

test('wrong SQLite money/quantity types and non-STRICT tables are never accepted as source-ready',async()=>{
  const x=fixture();try{
    for(const [table,column] of [
      ['products','current_unit_revision'],['party_legacy_links','source_id'],
      ['product_tile_measurement_revisions','length_text']
    ]){
      const f=(query,rows)=>query===`PRAGMA table_info('${table}')`?
        rows.map(r=>r.name===column?{...r,type:'REAL'}:r):rows;
      await assert.rejects(()=>verifyM03D1FoundationSchema(x.wrap(f)),/NEEDS_REVIEW|schema/i);
    }
    const loose=(query,rows)=>query==='PRAGMA table_list'?
      rows.map(r=>r.name==='party_legacy_links'?{...r,strict:0}:r):rows;
    await assert.rejects(()=>verifyM03D1FoundationSchema(x.wrap(loose)),/NEEDS_REVIEW|schema/i);
  }finally{x.close();}
});

test('missing or duplicate table metadata, ambiguous column descriptors and D1 failures reject without data disclosure',async()=>{
  const x=fixture();try{
    const corruptions=[
      (q,rows)=>q==='PRAGMA table_list'?rows.filter(r=>r.name!=='parties'):rows,
      (q,rows)=>q==='PRAGMA table_list'?[...rows,...rows.filter(r=>r.name==='parties')]:rows,
      (q,rows)=>q==="PRAGMA table_info('settings')" ? [...rows,rows.find(r=>r.name==='key')]:rows,
      (q,rows)=>q==="PRAGMA table_info('settings')" ? [{name:'key',type:'TEXT'}]:rows,
      (q,rows)=>q==="PRAGMA table_info('settings')" ? rows.map(r=>r.name==='value'?{...r,type:null}:r):rows
    ];
    for(const f of corruptions){
      await assert.rejects(()=>verifyM03D1FoundationSchema(x.wrap(f)),
        /NEEDS_REVIEW|D1.*schema|metadata/i);
    }
    const dbError={DB:{prepare(){throw new Error('PRIVATE_SETTINGS_SQL_AND_PII');}}};
    await assert.rejects(()=>verifyM03D1FoundationSchema(dbError),err=>
      err instanceof Error && /NEEDS_REVIEW|schema/i.test(err.message) &&
      !err.message.includes('PRIVATE_SETTINGS_SQL_AND_PII'));
    await assert.rejects(()=>verifyM03D1FoundationSchema({
      DB:{prepare(){return {all:async()=>({success:false,results:[]})};}}
    }),/NEEDS_REVIEW|schema/i);
  }finally{x.close();}
});

test('no D1 binding or extra user parameters can activate schema reads or financial RPC',async()=>{
  await assert.rejects(()=>verifyM03D1FoundationSchema({}),/D1|binding|schema/i);
  const src=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(src.includes('verifyM03D1FoundationSchema'),false);
  assert.doesNotMatch(src,/\/__m03_schema__\/|\/api\/schema-preflight/);
});
