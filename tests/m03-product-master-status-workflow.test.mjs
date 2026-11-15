import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createProductMasterStatusWorkflow} from '../src/modules/product-master-status-workflow.js';

const ddl=readFileSync(new URL('../migrations/0001_core_catalog.sql',import.meta.url),'utf8');
const source=readFileSync(new URL('../legacy/source/ProductSettings.gs',import.meta.url),'utf8');

function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(ddl);
  db.exec("INSERT INTO product_categories(category_id,category_name,status,legacy_sheet_row) VALUES "+
    "('CAT-A','Electrical','Active',2),('CAT-B','Hardware','Inactive',3),"+
    "('CAT-C','Hardware Plus','Active',4); "+
    "INSERT INTO product_units(unit_id,unit_name,status,legacy_sheet_row) VALUES "+
    "('UNT-A','Pcs','Inactive',2),('UNT-B','Feet','Active',3);");
  let batches=0,statementCount=0;
  const DB={
    prepare(sql){
      statementCount++;
      const prepared=db.prepare(sql);
      const statement=(args=[])=>({
        prepared,args,sql,
        bind(...nextArgs){return statement(nextArgs);},
        async all(){return {success:true,results:prepared.all(...args)};},
        async first(){return prepared.get(...args)??null;},
        async run(){return {success:true,meta:prepared.run(...args)};}
      });
      return statement();
    },
    async batch(items){
      batches++;
      db.exec('BEGIN IMMEDIATE');
      try{
        const out=items.map(item=>({success:true,results:item.prepared.all(...item.args)}));
        db.exec('COMMIT');
        return out;
      }catch(error){db.exec('ROLLBACK');throw error;}
    }
  };
  return {
    db,DB,workflow:createProductMasterStatusWorkflow({DB}),
    rows:table=>db.prepare("SELECT * FROM "+(table==='categories'?'product_categories':'product_units')+" ORDER BY legacy_sheet_row").all(),
    batches:()=>batches,statements:()=>statementCount,
    close:()=>db.close()
  };
}
function originalOracle(kind,status,exists=true){
  const name=kind==='category'?'setProductCategoryStatus':'setProductUnitStatus';
  const start=source.indexOf('function '+name+'(');
  assert(start>=0);
  const end=kind==='category'?source.indexOf('// ---------------- Product Units',start):source.length;
  const writes=[];
  const context={
    requirePermission_(){},
    findRowIndex_(){return exists?3:-1;},
    updateRowFields_(...args){writes.push(['update',...args]);},
    deleteRow_(...args){writes.push(['delete',...args]);},
    ok_(data){return {success:true,data};},
    fail_(message){return {success:false,message};},
    logError_(){}
  };
  const id=kind==='category'?'CAT-B':'UNT-A';
  const result=runInNewContext(
    source.slice(start,end)+'\n'+name+'("test-token",'+JSON.stringify(id)+','+
    JSON.stringify(status)+');',context
  );
  return {response:JSON.parse(JSON.stringify(result)),writes:JSON.parse(JSON.stringify(writes))};
}
test('original frozen category activation and unit removal envelopes are preserved',async()=>{
  const x=fixture();
  try{
    const a=originalOracle('category','Active');
    assert.deepEqual(a.response,{success:true,data:{id:'CAT-B',status:'Active'}});
    assert.deepEqual(a.writes,[['update','PRODUCT_CATEGORIES',3,{Status:'Active'}]]);
    assert.deepEqual(await x.workflow.setCategoryStatus_('CAT-B','Active'),a.response);
    const category=x.rows('categories').find(r=>r.category_id==='CAT-B');
    assert.deepEqual([category.category_name,category.status,category.legacy_sheet_row],
      ['Hardware','Active',3]);
    const u=originalOracle('unit','Inactive');
    assert.deepEqual(u.response,{success:true,data:{id:'UNT-A',deleted:true}});
    assert.deepEqual(u.writes,[['delete','PRODUCT_UNITS',3]]);
    assert.deepEqual(await x.workflow.setUnitStatus_('UNT-A','Inactive'),u.response);
    assert.deepEqual(x.rows('units').map(r=>[r.unit_id,r.legacy_sheet_row]),[['UNT-B',2]]);
    assert.equal(x.batches(),1);
    assert.equal(x.rows('categories').length,3);
  }finally{x.close();}
});
test('source ID deletion compacts physical rows and does not delete shifted sibling on replay',async()=>{
  const x=fixture();
  try{
    assert.deepEqual(await x.workflow.setCategoryStatus_('CAT-B','Inactive'),{
      success:true,data:{id:'CAT-B',deleted:true}
    });
    assert.deepEqual(x.rows('categories').map(r=>[r.category_id,r.legacy_sheet_row]),
      [['CAT-A',2],['CAT-C',3]]);
    assert.deepEqual(await x.workflow.setCategoryStatus_('CAT-B','Inactive'),{
      success:false,message:'Category not found.'
    });
    assert.deepEqual(x.rows('categories').map(r=>[r.category_id,r.legacy_sheet_row]),
      [['CAT-A',2],['CAT-C',3]]);
  }finally{x.close();}
});
test('original not-found response and no category/unit writes',async()=>{
  const x=fixture();
  try{
    const before=[x.rows('categories'),x.rows('units')];
    assert.deepEqual(await x.workflow.setCategoryStatus_('CAT-UNKNOWN','Active'),
      originalOracle('category','Active',false).response);
    assert.deepEqual(await x.workflow.setUnitStatus_('UNT-UNKNOWN','Inactive'),
      originalOracle('unit','Inactive',false).response);
    assert.deepEqual([x.rows('categories'),x.rows('units')],before);
    assert.equal(x.batches(),0);
  }finally{x.close();}
});
test('unknown status or malformed source identity refuses before any D1 operation',async()=>{
  const x=fixture();
  try{
    const start=x.statements();
    for(const status of [null,undefined,'','Deleted','active',' inactive',{},[],false]){
      await assert.rejects(
        ()=>x.workflow.setCategoryStatus_('CAT-B',status),
        /invalid|status|allowed/i
      );
    }
    for(const id of [null,undefined,'',{},[],'CAT-B; DROP',' CAT-B','CAT-B ']){
      await assert.rejects(
        ()=>x.workflow.setUnitStatus_(id,'Active'),
        /invalid|source|ID/i
      );
    }
    assert.equal(x.statements(),start);
    assert.equal(x.batches(),0);
  }finally{x.close();}
});
test('stale source-name preimage changed after read fails CAS without overwriting D1',async()=>{
  const x=fixture();
  try{
    let altered=false;
    const DB={
      batch:s=>x.DB.batch(s),
      prepare(sql){
        if(!altered && /^\s*UPDATE product_categories\b/i.test(sql)){
          altered=true;
          x.db.exec("UPDATE product_categories SET category_name='Concurrent Edit' WHERE category_id='CAT-B'");
        }
        return x.DB.prepare(sql);
      }
    };
    await assert.rejects(
      ()=>createProductMasterStatusWorkflow({DB}).setCategoryStatus_('CAT-B','Active'),
      /stale|precondition|refused|provenance/i
    );
    const saved=x.rows('categories').find(r=>r.category_id==='CAT-B');
    assert.equal(saved.category_name,'Concurrent Edit');
    assert.equal(saved.status,'Inactive');
  }finally{x.close();}
});
test('two concurrent duplicate deletion requests commit once and keep contiguous rows',async()=>{
  const x=fixture();
  try{
    const results=await Promise.allSettled([
      x.workflow.setUnitStatus_('UNT-A','Inactive'),
      x.workflow.setUnitStatus_('UNT-A','Inactive')
    ]);
    assert.equal(results.filter(r=>r.status==='fulfilled'&&r.value.success===true).length,1);
    assert.deepEqual(x.rows('units').map(r=>[r.unit_id,r.legacy_sheet_row]),[['UNT-B',2]]);
    assert(x.batches()>=1 && x.batches()<=2);
  }finally{x.close();}
});
test('SQLite failure during physical row compaction rolls back original deletion',async()=>{
  const x=fixture();
  try{
    const before=x.rows('categories');
    x.db.exec("CREATE TRIGGER fail_compact BEFORE UPDATE ON product_categories "+
      "WHEN NEW.legacy_sheet_row > 1002 BEGIN SELECT RAISE(ABORT,'mid-compaction-failure'); END");
    await assert.rejects(
      ()=>x.workflow.setCategoryStatus_('CAT-B','Inactive'),
      /mid-compaction-failure/i
    );
    assert.deepEqual(x.rows('categories'),before);
    x.db.exec('DROP TRIGGER fail_compact');
    assert.deepEqual(await x.workflow.setCategoryStatus_('CAT-B','Inactive'),
      {success:true,data:{id:'CAT-B',deleted:true}});
    assert.deepEqual(x.rows('categories').map(r=>r.legacy_sheet_row),[2,3]);
  }finally{x.close();}
});
test('workflow remains internal, with no public RPC or production endpoint',()=>{
  const live=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(live.includes('product-master-status-workflow'),false);
  assert.equal(live.includes('setCategoryStatus_'),false);
  assert.equal(live.includes('setUnitStatus_'),false);
});
test('D1 and transactional delete binding are both mandatory',()=>{
  assert.throws(()=>createProductMasterStatusWorkflow({}),/D1|binding/i);
  assert.throws(()=>createProductMasterStatusWorkflow({DB:{prepare(){}}}),/batch|D1|transaction/i);
});
