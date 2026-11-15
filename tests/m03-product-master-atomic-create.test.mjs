import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {SYNTHETIC_M03_MASTER_ATOMIC_DDL} from './fixtures/m03-master-atomic-schema.mjs';
import {createM03AtomicProductMasterCreator} from '../src/modules/m03-product-master-atomic-create.js';

const CORE=readFileSync(new URL('../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
const rows=(db,table)=>db.prepare('SELECT * FROM '+table+' ORDER BY legacy_sheet_row').all().map(r=>({...r}));
const scalar=(db,sql)=>db.prepare(sql).get();

function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(CORE);
  for(const statement of SYNTHETIC_M03_MASTER_ATOMIC_DDL)db.exec(statement);
  db.exec("INSERT INTO product_categories(category_id,category_name,status,legacy_sheet_row) VALUES "+
    "('PCAT-000002','Electrical','Active',2),"+
    "('PCAT-000005','Wire','Inactive',3),"+
    "('PCAT-000006',' wire ','Paused',4),"+
    "('PCAT-000016','Other','Active',5);"+
    "INSERT INTO product_units(unit_id,unit_name,status,legacy_sheet_row) VALUES "+
    "('PUNT-000007','Pcs','Active',2);"+
    "INSERT INTO synthetic_m03_id_counters(tenant_id,id_key,prefix,current_sequence) VALUES "+
    "('BUS-A','PRODUCT_CATEGORIES','PCAT',16),"+
    "('BUS-A','PRODUCT_UNITS','PUNT',7);");
  const statements=[];
  const DB={
    prepare(sql){
      statements.push(sql);
      const statement=db.prepare(sql);
      return {bind(...args){
        return {
          async first(){return statement.get(...args)??null;},
          async all(){return {success:true,results:statement.all(...args)};},
          async run(){const meta=statement.run(...args);return {success:true,meta:{changes:meta.changes}};}
        };
      }};
    }
  };
  const creator=createM03AtomicProductMasterCreator({DB},{businessId:'BUS-A'});
  const state=()=>({
    categories:rows(db,'product_categories'),
    units:rows(db,'product_units'),
    counters:db.prepare('SELECT id_key,current_sequence FROM synthetic_m03_id_counters ORDER BY id_key').all(),
    receipts:db.prepare('SELECT id_key,operation_id,intent_hash,issued_sequence FROM synthetic_m03_id_receipts ORDER BY id_key,operation_id').all(),
    intents:db.prepare('SELECT id_key,operation_id,intent_hash,result_id FROM synthetic_m03_master_intents ORDER BY id_key,operation_id').all()
  });
  return {db,DB,creator,state,statements,close:()=>db.close()};
}

test('one atomic Category INSERT issues source PCAT sequence from approved high-water 16',async()=>{
  const x=fixture();try{
    assert.deepEqual(await x.creator.createCategory_({operationId:'OP-CREATE',name:'  Tools  '}),{
      success:true,data:{id:'PCAT-000017',name:'Tools'}
    });
    const state=x.state();
    assert.deepEqual(state.categories.map(r=>r.legacy_sheet_row),[2,3,4,5,6]);
    assert.deepEqual(state.categories.at(-1).category_id,'PCAT-000017');
    assert.equal(state.categories.at(-1).status,'Active');
    assert.equal(state.categories.at(-1).category_name,'Tools');
    assert.equal(state.counters.find(r=>r.id_key==='PRODUCT_CATEGORIES').current_sequence,17);
    assert.equal(state.receipts.length,1);
    assert.equal(state.intents.length,1);
    assert.equal(state.intents[0].result_id,'PCAT-000017');
  }finally{x.close();}
});

test('source-matched inactive duplicate cleanup, contiguous sheet indices and new PCAT ID share one transaction',async()=>{
  const x=fixture();try{
    assert.deepEqual(await x.creator.createCategory_({operationId:'OP-REUSE',name:' wiRe '}),{
      success:true,data:{id:'PCAT-000017',name:'wiRe'}
    });
    const saved=x.state();
    assert.deepEqual(saved.categories.map(r=>[r.category_id,r.legacy_sheet_row]),[
      ['PCAT-000002',2],['PCAT-000016',3],['PCAT-000017',4]
    ]);
    assert.equal(saved.categories[2].category_name,'wiRe');
    assert.equal(saved.units.length,1);
    assert.equal(saved.counters[0].current_sequence,17);
  }finally{x.close();}
});

test('active category or unit duplicate refuses before receipt/counter mutation',async()=>{
  const x=fixture();try{
    const before=x.state();
    assert.deepEqual(await x.creator.createCategory_({operationId:'OP-DUP',name:' electrical '}),{
      success:false,message:'A category with this name already exists.'
    });
    assert.deepEqual(await x.creator.createUnit_({operationId:'OP-DUP',name:' pCs '}),{
      success:false,message:'A unit with this name already exists.'
    });
    assert.deepEqual(x.state(),before);
  }finally{x.close();}
});

test('atomic Unit creation issues PUNT source family and preserves separate Category sequence',async()=>{
  const x=fixture();try{
    assert.deepEqual(await x.creator.createUnit_({operationId:'OP-UNIT',name:' গিরা '}),{
      success:true,data:{id:'PUNT-000008',name:'গিরা'}
    });
    const state=x.state();
    assert.deepEqual(state.units.map(r=>[r.unit_id,r.unit_name,r.legacy_sheet_row]),[
      ['PUNT-000007','Pcs',2],['PUNT-000008','গিরা',3]
    ]);
    assert.deepEqual(state.counters.map(r=>[r.id_key,r.current_sequence]),[
      ['PRODUCT_CATEGORIES',16],['PRODUCT_UNITS',8]
    ]);
  }finally{x.close();}
});

test('stable replay returns exact committed ID, changed normalized name refuses without any new write',async()=>{
  const x=fixture();try{
    const first=await x.creator.createCategory_({operationId:'OP-ONE',name:'Tools'});
    const before=x.state();
    assert.deepEqual(await x.creator.createCategory_({operationId:'OP-ONE',name:' Tools '}),first);
    await assert.rejects(
      ()=>x.creator.createCategory_({operationId:'OP-ONE',name:'Different'}),
      /intent|collision|operation/i
    );
    assert.deepEqual(x.state(),before);
  }finally{x.close();}
});

test('lost response after successful SQL INSERT recovers same source ID on exact operation retry',async()=>{
  const x=fixture();try{
    let lost=false;
    const dbProxy={prepare(sql){
      const statement=x.DB.prepare(sql);
      if(!sql.includes('INSERT INTO synthetic_m03_master_intents'))return statement;
      return {bind(...args){
        const original=statement.bind(...args);
        return {...original,async run(){
          const result=await original.run();
          if(!lost){lost=true;throw new Error('simulated network response loss');}
          return result;
        }};
      }};
    }};
    const caller=createM03AtomicProductMasterCreator({DB:dbProxy},{businessId:'BUS-A'});
    await assert.rejects(
      ()=>caller.createCategory_({operationId:'OP-LOST',name:'Tape'}),
      /response loss/i
    );
    assert.equal(x.state().intents.length,1);
    const before=x.state();
    assert.deepEqual(await caller.createCategory_({operationId:'OP-LOST',name:'Tape'}),{
      success:true,data:{id:'PCAT-000017',name:'Tape'}
    });
    assert.deepEqual(x.state(),before);
  }finally{x.close();}
});

test('two concurrent different operations for the same normalized name cannot both create',async()=>{
  const x=fixture();try{
    const results=await Promise.allSettled([
      x.creator.createCategory_({operationId:'OP-RACE-1',name:'Latch'}),
      x.creator.createCategory_({operationId:'OP-RACE-2',name:'latch'})
    ]);
    const successes=results.filter(r=>r.status==='fulfilled'&&r.value.success===true);
    assert.equal(successes.length,1);
    assert.equal(x.state().categories.filter(r=>r.category_name.toLowerCase()==='latch').length,1);
    assert.equal(x.state().receipts.length,1);
    assert.equal(x.state().intents.length,1);
    assert.equal(x.state().counters[0].current_sequence,17);
  }finally{x.close();}
});

test('late catalog INSERT trigger aborts cleanup, source ID counter, receipt and intent together',async()=>{
  const x=fixture();try{
    x.db.exec("CREATE TRIGGER refuse_created_master BEFORE INSERT ON product_categories "+
      "WHEN NEW.category_name='wire' BEGIN SELECT RAISE(ABORT,'forced late catalog failure'); END");
    const before=x.state();
    await assert.rejects(
      ()=>x.creator.createCategory_({operationId:'OP-FAIL',name:'wire'}),
      /forced late catalog failure/i
    );
    assert.deepEqual(x.state(),before);
    x.db.exec('DROP TRIGGER refuse_created_master');
    assert.deepEqual(await x.creator.createCategory_({operationId:'OP-FAIL',name:'wire'}),{
      success:true,data:{id:'PCAT-000017',name:'wire'}
    });
  }finally{x.close();}
});

test('stale catalog state after preflight rejects the entire pending source creation',async()=>{
  const x=fixture();try{
    let raced=false;
    const proxy={prepare(sql){
      const statement=x.DB.prepare(sql);
      if(!sql.includes('INSERT INTO synthetic_m03_master_intents'))return statement;
      return {bind(...args){
        const original=statement.bind(...args);
        return {...original,async run(){
          if(!raced){raced=true;x.db.exec("UPDATE product_categories SET category_name='Changed' WHERE category_id='PCAT-000016'");}
          return original.run();
        }};
      }};
    }};
    const creator=createM03AtomicProductMasterCreator({DB:proxy},{businessId:'BUS-A'});
    await assert.rejects(
      ()=>creator.createCategory_({operationId:'OP-STALE',name:'Tools'}),
      /stale master catalog snapshot/i
    );
    const state=x.state();
    assert.equal(state.categories.find(r=>r.category_id==='PCAT-000016').category_name,'Changed');
    assert.equal(state.counters[0].current_sequence,16);
    assert.equal(state.intents.length,0);
    assert.equal(state.receipts.length,0);
  }finally{x.close();}
});

test('missing or exhausted counter causes no source master mutation',async()=>{
  const x=fixture();try{
    x.db.exec("DELETE FROM synthetic_m03_id_counters WHERE id_key='PRODUCT_UNITS'");
    const before=x.state();
    await assert.rejects(()=>x.creator.createUnit_({operationId:'OP-NOCOUNTER',name:'Feet'}),/counter|missing/i);
    assert.deepEqual(x.state(),before);
    x.db.exec("UPDATE synthetic_m03_id_counters SET current_sequence=9007199254740991 WHERE id_key='PRODUCT_CATEGORIES'");
    const other=x.state();
    await assert.rejects(()=>x.creator.createCategory_({operationId:'OP-EXHAUSTED',name:'Tools'}),/counter|exhausted/i);
    assert.deepEqual(x.state(),other);
  }finally{x.close();}
});

test('blank names and malformed client operation IDs are rejected without running D1 SQL',async()=>{
  const x=fixture();try{
    const before=x.state();
    assert.deepEqual(await x.creator.createCategory_({operationId:'OP-BLANK',name:'   '}),{
      success:false,message:'Category name is required.'
    });
    for(const input of [null,undefined,'',{},[],true,1,'OP;DROP','op lower']){
      await assert.rejects(
        ()=>x.creator.createUnit_({operationId:input,name:'Feet'}),
        /operation|invalid/i
      );
    }
    await assert.rejects(()=>x.creator.createUnit_({operationId:'OP',name:{toString(){return 'Feet';}}}),/invalid|string|name/i);
    assert.deepEqual(x.state(),before);
  }finally{x.close();}
});

test('request journal and source ID receipts cannot be rewritten or removed',async()=>{
  const x=fixture();try{
    await x.creator.createCategory_({operationId:'OP-IMMUTABLE',name:'Tools'});
    assert.throws(()=>x.db.exec("UPDATE synthetic_m03_master_intents SET name='Evil'"),/immutable/i);
    assert.throws(()=>x.db.exec("DELETE FROM synthetic_m03_master_intents"),/immutable/i);
    assert.throws(()=>x.db.exec("UPDATE synthetic_m03_id_receipts SET intent_hash='changed'"),/immutable/i);
  }finally{x.close();}
});

test('method stays internal with no live RPC, deployable schema or production Cloudflare binding',()=>{
  const live=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert(!live.includes('m03-product-master-atomic-create'));
  assert(!live.includes('synthetic_m03_master_intents'));
  assert.throws(()=>createM03AtomicProductMasterCreator({},{businessId:'BUS-A'}),/D1|binding/i);
  assert.throws(()=>createM03AtomicProductMasterCreator({DB:{prepare(){}}},{businessId:'../../evil'}),/business/i);
});
