import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {runInNewContext} from 'node:vm';
import {createProductMasterCreatePreflight} from '../src/modules/product-master-create-preflight.js';

const SOURCE=readFileSync(new URL('../legacy/source/ProductSettings.gs',import.meta.url),'utf8');
const DDL=readFileSync(new URL('../migrations/0001_core_catalog.sql',import.meta.url),'utf8');

function fixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(DDL);
  db.exec("INSERT INTO product_categories(category_id,category_name,status,legacy_sheet_row) VALUES "+
    "('CAT-A','Electrical','Active',2),('CAT-B','Tools','Inactive',3),"+
    "('CAT-C',' tools ','Paused',4),('CAT-D','Mystery','',5); "+
    "INSERT INTO product_units(unit_id,unit_name,status,legacy_sheet_row) VALUES "+
    "('UNT-A','Pcs','Active',2),('UNT-B',' গিরা ','inactive',3),"+
    "('UNT-C','গিরা','Inactive',4);");
  const sql=[];
  const DB={prepare(query){
    sql.push(query);
    const statement=db.prepare(query);
    return {bind(...args){
      return {async all(){return {success:true,results:statement.all(...args)};}};
    }};
  }};
  return {db,sql,DB,service:createProductMasterCreatePreflight({DB}),close:()=>db.close()};
}

function sourceOracle(group,name,records){
  const method=group==='category'?'addProductCategory':'addProductUnit';
  const start=SOURCE.indexOf('function '+method+'(');
  const end=group==='category'?
    SOURCE.indexOf('function setProductCategoryStatus(',start):
    SOURCE.indexOf('function setProductUnitStatus(',start);
  assert(start>=0&&end>start,'frozen ProductSettings original function missing');
  const sheet=group==='category'?'PRODUCT_CATEGORIES':'PRODUCT_UNITS';
  const idHeader=group==='category'?'Category ID':'Unit ID';
  let mutable=records.map(row=>({...row}));
  const deleted=[],appended=[];
  const context={
    CONFIG:{LOCK_TIMEOUT_MS:1000},
    LockService:{getScriptLock(){return {waitLock(){},releaseLock(){}};}},
    requirePermission_(){},
    sanitizeInput_(input){return input==null?'':String(input).trim();},
    getAllRows_(key){
      assert.equal(key,sheet);
      return mutable.map(row=>({...row}));
    },
    findRowIndex_(key,field,id){
      assert.equal(key,sheet);
      assert.equal(field,idHeader);
      const index=mutable.findIndex(row=>row[idHeader]===id);
      return index===-1?-1:index+2;
    },
    deleteRow_(key,rowIndex){
      assert.equal(key,sheet);
      const row=mutable[rowIndex-2];
      if(!row)throw new Error('Wrong original row index');
      deleted.push({sourceId:row[idHeader],rowIndex,name:row[group==='category'?'Category Name':'Unit Name'],status:row.Status});
      mutable.splice(rowIndex-2,1);
    },
    generateId_(){return 'TEST-NEXT-1';},
    appendRow_(key,row){assert.equal(key,sheet);appended.push(row);},
    ok_(data){return {success:true,data};},
    fail_(message){return {success:false,message};},
    logError_(){}
  };
  const result=runInNewContext(
    SOURCE.slice(start,end)+'\n'+method+'("test-token",{name:'+JSON.stringify(name)+'});',
    context
  );
  return {result:JSON.parse(JSON.stringify(result)),deleted,appended:appended.length};
}

test('category active duplicate blocks creation exactly as frozen ProductSettings, including casing',async()=>{
  const x=fixture();
  try{
    const original=sourceOracle('category',' eLeCtRiCaL ',[
      {'Category ID':'CAT-A','Category Name':'Electrical',Status:'Active'}
    ]);
    assert.deepEqual(original.result,{
      success:false,message:'A category with this name already exists.'
    });
    assert.equal(original.deleted.length,0);
    assert.deepEqual(await x.service.checkCategoryName_(' eLeCtRiCaL '),{
      canCreate:false,message:original.result.message,name:'eLeCtRiCaL',cleanup:[]
    });
    assert(x.sql.every(s=>/^\s*SELECT\b/i.test(s)));
    assert.equal(x.sql.length,1);
  }finally{x.close();}
});

test('inactive and non-active matched category source rows yield cleanup plan in physical order without writes',async()=>{
  const x=fixture();
  try{
    const original=sourceOracle('category','TOOLS',[
      {'Category ID':'CAT-B','Category Name':'Tools',Status:'Inactive'},
      {'Category ID':'CAT-C','Category Name':' tools ',Status:'Paused'}
    ]);
    assert.equal(original.result.success,true);
    assert.deepEqual(original.deleted.map(d=>d.sourceId),['CAT-B','CAT-C']);
    assert.deepEqual(await x.service.checkCategoryName_(' TOOLS '),{
      canCreate:true,name:'TOOLS',
      cleanup:[
        {sourceId:'CAT-B',rowIndex:3,name:'Tools',status:'Inactive'},
        {sourceId:'CAT-C',rowIndex:4,name:' tools ',status:'Paused'}
      ]
    });
    assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM product_categories').get().n,4);
    assert(x.sql.every(s=>/^\s*SELECT\b/i.test(s)));
  }finally{x.close();}
});

test('blank source Status defaults to Active and blocks duplicate, not scheduled for cleanup',async()=>{
  const x=fixture();
  try{
    const original=sourceOracle('category','Mystery',[
      {'Category ID':'CAT-D','Category Name':'Mystery',Status:''}
    ]);
    assert.equal(original.result.success,false);
    assert.deepEqual(await x.service.checkCategoryName_('Mystery'),{
      canCreate:false,message:'A category with this name already exists.',
      name:'Mystery',cleanup:[]
    });
  }finally{x.close();}
});

test('Unicode and mixed-case unit labels use JavaScript trim + lowercase, not SQL ASCII collation',async()=>{
  const x=fixture();
  try{
    const original=sourceOracle('unit',' গিরা ',[
      {'Unit ID':'UNT-B','Unit Name':' গিরা ',Status:'inactive'},
      {'Unit ID':'UNT-C','Unit Name':'গিরা',Status:'Inactive'}
    ]);
    assert.equal(original.result.success,true);
    assert.deepEqual(original.deleted.map(v=>v.sourceId),['UNT-B','UNT-C']);
    assert.deepEqual(await x.service.checkUnitName_(' গিরা '),{
      canCreate:true,name:'গিরা',
      cleanup:[
        {sourceId:'UNT-B',rowIndex:3,name:' গিরা ',status:'inactive'},
        {sourceId:'UNT-C',rowIndex:4,name:'গিরা',status:'Inactive'}
      ]
    });
    assert.deepEqual(await x.service.checkUnitName_('pcs'),{
      canCreate:false,message:'A unit with this name already exists.',name:'pcs',cleanup:[]
    });
  }finally{x.close();}
});

test('blank names preserve original error and never read D1; novel names are safe empty plans',async()=>{
  const x=fixture();
  try{
    assert.equal(sourceOracle('category','  ',[]).result.message,'Category name is required.');
    assert.equal(sourceOracle('unit','  ',[]).result.message,'Unit name is required.');
    assert.deepEqual(await x.service.checkCategoryName_('  '),{
      canCreate:false,message:'Category name is required.',name:'',cleanup:[]
    });
    assert.deepEqual(await x.service.checkUnitName_(''),{
      canCreate:false,message:'Unit name is required.',name:'',cleanup:[]
    });
    assert.equal(x.sql.length,0);
    assert.deepEqual(await x.service.checkCategoryName_('New Category'),{
      canCreate:true,name:'New Category',cleanup:[]
    });
  }finally{x.close();}
});

test('strict input validation rejects objects/numbers and does not call D1',async()=>{
  const x=fixture();
  try{
    for(const input of [null,undefined,{},[],12,true,Symbol('category')]){
      await assert.rejects(()=>x.service.checkCategoryName_(input),/name|invalid|string/i);
    }
    assert.equal(x.sql.length,0);
  }finally{x.close();}
});

test('invalid physical index and duplicate source IDs reject instead of producing unsafe cleanup',async()=>{
  const x=fixture();
  try{
    x.db.exec("UPDATE product_categories SET legacy_sheet_row=44 WHERE category_id='CAT-C'");
    await assert.rejects(()=>x.service.checkCategoryName_('Tools'),/row|physical|provenance/i);
    x.db.exec("UPDATE product_categories SET legacy_sheet_row=4 WHERE category_id='CAT-C'");
    const corrupt={DB:{prepare(){
      return {bind(){return {async all(){return {success:true,results:[
        {legacy_sheet_row:2,category_id:'CAT-DUP',category_name:'Used',status:'Inactive',created_at:null},
        {legacy_sheet_row:3,category_id:'CAT-DUP',category_name:'Used',status:'Inactive',created_at:null}
      ]};}};}}};
    }}};
    await assert.rejects(()=>createProductMasterCreatePreflight(corrupt).checkCategoryName_('Used'),
      /duplicate|ID|unsafe|source/i);
  }finally{x.close();}
});

test('malformed D1 result and missing binding fail closed, no fallback to GAS or cache',async()=>{
  const x=fixture();
  try{
    const invalid={DB:{prepare(){return {bind(){return {async all(){return {success:false,results:[]};}};}};}}};
    await assert.rejects(()=>createProductMasterCreatePreflight(invalid).checkUnitName_('pcs'),
      /D1|invalid|result/i);
    assert.throws(()=>createProductMasterCreatePreflight({}),/binding|D1/i);
    assert.equal(x.db.prepare('SELECT COUNT(*) AS n FROM product_units').get().n,3);
  }finally{x.close();}
});

test('new preflight is not accessible from the real public RPC registry',()=>{
  const live=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(live.includes('product-master-create-preflight'),false);
  assert.equal(live.includes('checkCategoryName_'),false);
  assert.equal(live.includes('checkUnitName_'),false);
});
