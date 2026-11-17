import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {CANONICAL_PRODUCT_HEADERS} from '../src/db/product-source-contract.js';
import {createCanonicalProductSourceReadAdapter}
  from '../src/db/canonical-product-source-read.js';

const SQL=readFileSync(new URL('../migrations/0012_legacy_product_snapshots.sql',import.meta.url),'utf8');
const COLUMNS=[
  'product_id','product_name','brand_text','category_text','unit_text',
  'barcode_text','purchase_price_text','selling_price_text','current_stock_text',
  'minimum_stock_text','status_text','created_at_text','updated_at_text',
  'is_deleted_text','deleted_by','deleted_at_text','delete_reason',
  'product_type_text','bundle_revision_text'
];
function fixture(){
  const sql=new DatabaseSync(':memory:');
  sql.exec('PRAGMA foreign_keys=ON');
  sql.exec(SQL);
  const prepare=sql.prepare('INSERT INTO legacy_product_snapshots '+
    '(source_profile,legacy_sheet_row,'+COLUMNS.join(',')+') VALUES ('+
    Array.from({length:COLUMNS.length+2},()=>'?').join(',')+')');
  const row=(position,id,name,changes={})=>{
    const data=Object.assign(Object.create(null),{
      product_id:id,product_name:name,brand_text:'',category_text:'',
      unit_text:'Pcs',barcode_text:'',purchase_price_text:'',selling_price_text:'',
      current_stock_text:'',minimum_stock_text:'',status_text:'Active',
      created_at_text:'',updated_at_text:'',is_deleted_text:'',
      deleted_by:'',deleted_at_text:'',delete_reason:'',product_type_text:'',
      bundle_revision_text:''
    },changes);
    prepare.run('canonical',position,...COLUMNS.map(key=>data[key]));
  };
  row(2,'PRD-0007','বাল্ব',{barcode_text:'000777',
    purchase_price_text:'001.50',current_stock_text:'0002.500',
    selling_price_text:'২২০',brand_text:'নবাবী'});
  row(3,'PRD-0008','বাল্ব',{status_text:'Inactive',is_deleted_text:'TRUE',
    delete_reason:'archived',unit_text:'Box'});
  row(4,'PRD-0009','পাইপ',{product_type_text:'Bundle',bundle_revision_text:'3',
    current_stock_text:'0'});
  // Supplementary multi-unit feature is independent even if Product ID
  // happens to match the pinned canonical source ID.
  sql.prepare('INSERT INTO legacy_product_snapshots '+
    '(source_profile,legacy_sheet_row,product_id,product_name,unit_text) VALUES(?,?,?,?,?)')
    .run('supplementary',2,'PRD-0007','UNREVIEWED DIFFERENT SOURCE','Feet');
  const queries=[],bindings=[];
  const DB={prepare(query){
    queries.push(query);
    const prepared=sql.prepare(query);
    return {bind(...args){
      bindings.push(args);
      return {async all(){
        return {success:true,results:prepared.all(...args).map(row=>({...row}))};
      }};
    }};
  }};
  return {sql,env:{DB},queries,bindings,close:()=>sql.close()};
}
const sourceRow=(position,fields)=>{
  const row=Object.fromEntries(CANONICAL_PRODUCT_HEADERS.map(h=>[h,'']));
  Object.assign(row,fields);
  row._rowIndex=position;
  return row;
};

test('awaited canonical source read preserves all 19 frozen headers, order, text and original physical rows',async()=>{
  const x=fixture();try{
    const reader=createCanonicalProductSourceReadAdapter(x.env);
    assert.deepEqual(await reader.getSheetHeaders_('PRODUCTS'),CANONICAL_PRODUCT_HEADERS);
    const rows=await reader.getAllRows_('PRODUCTS');
    assert.deepEqual(rows,[
      sourceRow(2,{'Product ID':'PRD-0007','Product Name':'বাল্ব','Brand':'নবাবী',
        Unit:'Pcs',Barcode:'000777','Purchase Price':'001.50',
        'Selling Price':'২২০','Current Stock':'0002.500',Status:'Active'}),
      sourceRow(3,{'Product ID':'PRD-0008','Product Name':'বাল্ব',Unit:'Box',
        Status:'Inactive','Is Deleted':'TRUE','Delete Reason':'archived'}),
      sourceRow(4,{'Product ID':'PRD-0009','Product Name':'পাইপ',Unit:'Pcs',
        'Current Stock':'0',Status:'Active','Product Type':'Bundle',
        'Bundle Revision':'3'})
    ]);
    assert(x.queries.every(q=>/^SELECT\s/i.test(q.trim())));
    assert(x.queries.every(q=>/WHERE source_profile\s*=\s*\?/i.test(q)));
    assert(x.queries.every(q=>/LIMIT\s+\?/i.test(q)));
    assert(x.bindings.every(args=>args[0]==='canonical'&&args[1]===1001));
    assert(rows.every(row=>Object.values(row).every(v=>typeof v==='string'||v===row._rowIndex)));
  }finally{x.close();}
});

test('source Database.gs-style find helpers await reads and preserve first-row/exact-string matching',async()=>{
  const x=fixture();try{
    const reader=createCanonicalProductSourceReadAdapter(x.env);
    assert.deepEqual((await reader.findRows_('PRODUCTS','Product Name','বাল্ব'))
      .map(row=>row._rowIndex),[2,3]);
    assert.equal((await reader.findFirstRow_('PRODUCTS','Product ID','PRD-0008'))._rowIndex,3);
    assert.deepEqual(await reader.findRow_('PRODUCTS','Product ID','PRD-0007'),{
      row:sourceRow(2,{'Product ID':'PRD-0007','Product Name':'বাল্ব','Brand':'নবাবী',
        Unit:'Pcs',Barcode:'000777','Purchase Price':'001.50',
        'Selling Price':'২২০','Current Stock':'0002.500',Status:'Active'}),
      rowIndex:2
    });
    assert.equal(await reader.findRowIndex_('PRODUCTS','Product ID','PRD-0009'),4);
    assert.equal(await reader.findRowIndex_('PRODUCTS','Product ID','PRD-00007'),-1);
    assert.equal(await reader.findRow_('PRODUCTS','Product ID','not-found'),null);
    assert.equal(await reader.findFirstRow_('PRODUCTS','Product ID','not-found'),null);
    assert.equal(await reader.findRows_('PRODUCTS','Current Stock','2.5').then(x=>x.length),0);
    assert.equal(reader.appendRow_,undefined);
    assert.equal(reader.updateRowFields_,undefined);
    assert.equal(reader.deleteRow_,undefined);
  }finally{x.close();}
});

test('unapproved source groups, columns and SQL identifiers refuse before D1 access',async()=>{
  const x=fixture();try{
    const reader=createCanonicalProductSourceReadAdapter(x.env);
    for(const key of ['SALES','SUPPLIERS','SETTINGS','PRODUCT_UNIT_CONVERSIONS',
      'products',"PRODUCTS; DROP TABLE parties",'']){
      await assert.rejects(()=>reader.getAllRows_(key),/source|sheet|PRODUCTS|unsupported/i);
      await assert.rejects(()=>reader.getSheetHeaders_(key),/source|sheet|PRODUCTS|unsupported/i);
    }
    for(const col of ['ProductID',"Product ID; DROP",'secret','_rowIndex']){
      await assert.rejects(()=>reader.findRows_('PRODUCTS',col,'x'),/column|unsupported/i);
    }
    assert.equal(x.queries.length,0);
    assert.throws(()=>createCanonicalProductSourceReadAdapter({}),/D1|binding/i);
  }finally{x.close();}
});

test('physical gaps, missing provenance, duplicated IDs or leaked supplementary rows fail closed',async()=>{
  const x=fixture();try{
    const base=x.env.DB;
    const reader=createCanonicalProductSourceReadAdapter(x.env);
    const mutate=fn=>createCanonicalProductSourceReadAdapter({DB:{
      prepare(query){
        const statement=base.prepare(query);
        return {bind(...args){
          const bound=statement.bind(...args);
          return {async all(){
            const out=await bound.all();
            return {success:true,results:fn(out.results.map(r=>({...r})))};
          }};
        }};
      }
    }});
    for(const transform of [
      rows=>rows.map(r=>r.legacy_sheet_row===3?{...r,legacy_sheet_row:9}:r),
      rows=>rows.map(r=>r.legacy_sheet_row===3?{...r,legacy_sheet_row:null}:r),
      rows=>rows.map(r=>r.product_id==='PRD-0008'?{...r,product_id:'PRD-0007'}:r),
      rows=>rows.map(r=>r.legacy_sheet_row===3?{...r,source_profile:'supplementary'}:r),
      rows=>rows.map(r=>r.legacy_sheet_row===3?{...r,barcode_text:7}:r),
      rows=>rows.map(r=>r.legacy_sheet_row===3?{...r,sensitive:'PRIVATE'}:r),
      rows=>rows.map(r=>r.legacy_sheet_row===3?null:r),
      rows=>rows.map(r=>r.legacy_sheet_row===3?
        Object.defineProperty({...r},'product_name',{enumerable:true,get(){throw Error('PRIVATE_SQL');}}):r)
    ]){
      await assert.rejects(()=>mutate(transform).getAllRows_('PRODUCTS'),
        err=>err instanceof Error && /invalid|D1|review|archive/i.test(err.message) &&
          !/PRIVATE_SQL|PRIVATE/.test(err.message));
    }
    assert.equal((await reader.getAllRows_('PRODUCTS')).length,3);
  }finally{x.close();}
});

test('bounded source archive read rejects 1001 canonical rows instead of truncation',async()=>{
  const x=fixture();try{
    const insert=x.sql.prepare('INSERT INTO legacy_product_snapshots'+
      '(source_profile,legacy_sheet_row,product_id,unit_text) VALUES(?,?,?,?)');
    for(let i=5;i<=1002;i++)insert.run('canonical',i,'PRD-'+i,'Pcs');
    assert.equal(x.sql.prepare("SELECT COUNT(*) AS n FROM legacy_product_snapshots WHERE source_profile='canonical'").get().n,1001);
    await assert.rejects(()=>createCanonicalProductSourceReadAdapter(x.env).getAllRows_('PRODUCTS'),
      /limit|exceeds|invalid|review/i);
  }finally{x.close();}
});

test('missing, failed, partial or stale D1 results never become a successful empty source',async()=>{
  const fake=answer=>({DB:{prepare(){return {bind(){return {async all(){return answer;}};}};}}});
  for(const result of [null,{}, {success:false,results:[]},{success:true,results:null},
    {success:true,results:[null]},{success:true,results:[{product_id:'PRD-001'}]}]){
    await assert.rejects(()=>createCanonicalProductSourceReadAdapter(fake(result))
      .getAllRows_('PRODUCTS'),/D1|invalid|review|archive/i);
  }
  const failing={DB:{prepare(){throw Error('SECRET_CREDENTIAL_AND_SQL');}}};
  await assert.rejects(()=>createCanonicalProductSourceReadAdapter(failing)
    .getAllRows_('PRODUCTS'),err=>!err.message.includes('SECRET_CREDENTIAL_AND_SQL'));
});

test('read is uncached and private, cannot activate production stock, archived prices or public RPC',async()=>{
  const x=fixture();try{
    const reader=createCanonicalProductSourceReadAdapter(x.env);
    const first=await reader.getAllRows_('PRODUCTS');
    first[0]['Product Name']='MUTATED';
    const second=await reader.getAllRows_('PRODUCTS');
    assert.equal(second[0]['Product Name'],'বাল্ব');
    assert.equal(x.queries.length,2);
    assert.equal(x.sql.prepare("SELECT COUNT(*) AS n FROM legacy_product_snapshots").get().n,4);
  }finally{x.close();}
  const publicWorker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  const registry=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.equal(publicWorker.includes('canonical-product-source-read'),false);
  assert.equal(registry.includes('PRODUCTS'),false);
});
