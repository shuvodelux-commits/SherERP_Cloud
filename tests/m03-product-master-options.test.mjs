import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {runInNewContext} from 'node:vm';
import {readFileSync} from 'node:fs';
import {createProductMasterOptionsReader} from '../src/modules/product-master-options.js';

function fixture() {
  const db=new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE product_categories (legacy_sheet_row INTEGER,category_id TEXT,category_name TEXT,status TEXT,created_at TEXT);
    CREATE TABLE product_units (legacy_sheet_row INTEGER,unit_id TEXT,unit_name TEXT,status TEXT,created_at TEXT);
    CREATE TABLE settings (row_id INTEGER PRIMARY KEY AUTOINCREMENT,key TEXT NOT NULL,value TEXT NOT NULL);
    INSERT INTO product_categories VALUES
      (2,'CAT-A','Electrical','Active',NULL),
      (3,'CAT-B','Old','Inactive',NULL),
      (4,'CAT-C','Electrical','Active',NULL),
      (5,'CAT-D','Lower case','inactive',NULL);
    INSERT INTO product_units VALUES
      (2,'UNT-A','Pcs','Active',NULL),
      (3,'UNT-B','Retired','Inactive',NULL),
      (4,'UNT-C','Feet','Active',NULL);
  `);
  const statements=[];
  const binding={prepare(sql) {
    statements.push(sql);
    const stmt=db.prepare(sql);
    return {bind(...values) {
      return {async all() {return {success:true,results:stmt.all(...values)};}};
    }};
  }};
  return {db,statements,env:{DB:binding}};
}

test('awaits D1 and preserves Products.gs option ID/name projection, physical order and duplicates',async()=>{
  const t=fixture();
  try {
    const result=await createProductMasterOptionsReader(t.env).getOptions();
    assert.deepEqual(result,{
      categories:[{id:'CAT-A',name:'Electrical'},{id:'CAT-C',name:'Electrical'},{id:'CAT-D',name:'Lower case'}],
      units:[{id:'UNT-A',name:'Pcs'},{id:'UNT-C',name:'Feet'}]
    });
    assert.equal(result.categories.some(row=>row.id instanceof Promise),false);
    assert.equal(result.units.some(row=>row.name instanceof Promise),false);
    assert.equal(t.statements.length,2);
    assert(t.statements.every(sql=>/^SELECT\b/i.test(sql)));
    assert(t.statements.every(sql=>/LIMIT\s+\?/i.test(sql)));
    assert(t.statements.every(sql=>!(/settings|products|payments|sales/i.test(sql))));
  }finally{t.db.close();}
});

test('empty categories and units return typed empty arrays, not null or pending promises',async()=>{
  const t=fixture();
  try {
    t.db.exec('DELETE FROM product_categories; DELETE FROM product_units;');
    assert.deepEqual(await createProductMasterOptionsReader(t.env).getOptions(),{categories:[],units:[]});
  }finally{t.db.close();}
});

test('missing D1 binding refuses initialization rather than reading live Sheets or a fallback DB',()=>{
  assert.throws(()=>createProductMasterOptionsReader({}),/D1|binding/i);
  assert.throws(()=>createProductMasterOptionsReader({DB:{}}),/D1|binding/i);
});

test('corrupt physical source row in either catalog fails the complete options request',async()=>{
  const t=fixture();
  try {
    t.db.exec('UPDATE product_categories SET legacy_sheet_row = 17 WHERE category_id = \'CAT-A\'');
    await assert.rejects(()=>createProductMasterOptionsReader(t.env).getOptions(),/legacy|physical|row index/i);
    t.db.exec('UPDATE product_categories SET legacy_sheet_row = 2 WHERE category_id = \'CAT-A\'');
    t.db.exec('UPDATE product_units SET legacy_sheet_row = NULL WHERE unit_id = \'UNT-B\'');
    await assert.rejects(()=>createProductMasterOptionsReader(t.env).getOptions(),/legacy|physical|row index/i);
  }finally{t.db.close();}
});

test('D1 query failure rejects without returning partial category or unit data',async()=>{
  const t=fixture();
  try {
    const broken={DB:{prepare(sql){
      if(sql.includes('product_units')) return {bind:()=>({all:async()=>({success:false,results:[]})})};
      return t.env.DB.prepare(sql);
    }}};
    await assert.rejects(()=>createProductMasterOptionsReader(broken).getOptions(),/D1|result/i);
  }finally{t.db.close();}
});


const originalProducts=readFileSync(
  new URL('../legacy/source/Products.gs',import.meta.url),'utf8'
);
const start=originalProducts.indexOf('function getProductsBootstrap(token) {');
const end=originalProducts.indexOf('\nfunction addProduct(',start);
assert(start>=0 && end>start,'original getProductsBootstrap must remain frozen');
const originalBootstrap=originalProducts.slice(start,end);

function sourceReferenceOracle({categories,units,settings}){
  const groups={
    PRODUCT_CATEGORIES:categories,
    PRODUCT_UNITS:units,
    STOCK_LOTS:[]
  };
  const context={
    requirePermission_(){},
    activeRows_(){return [];},
    bundleProductMap_(){return {};},
    getAllRows_(group){
      if(!Object.hasOwn(groups,group))throw new Error('Unexpected group '+group);
      return groups[group];
    },
    getSettingsMap_(){return settings;},
    ok_(data){return {success:true,data};},
    fail_(message){return {success:false,message};},
    logError_(){},
  };
  const result=runInNewContext(
    originalBootstrap+'\ngetProductsBootstrap("local-test-token");',context
  );
  assert.equal(result.success,true,JSON.stringify(result));
  const data=JSON.parse(JSON.stringify(result.data));
  assert.deepEqual(data.products,[]);
  return {
    categories:data.categories,
    units:data.units,
    currencySymbol:data.currencySymbol,
    lowStockThreshold:data.lowStockThreshold
  };
}

test('awaited Products bootstrap reference slice exactly matches executable frozen Products.gs oracle',async()=>{
  const t=fixture();
  try {
    t.db.exec([
      "INSERT INTO settings(key,value) VALUES('Currency Symbol','৳')",
      "INSERT INTO settings(key,value) VALUES('Low Stock Threshold','8')",
      "INSERT INTO settings(key,value) VALUES('Phone 1','01711111111')",
      "INSERT INTO settings(key,value) VALUES('Delete Confirmation Key','KEEP-PRIVATE')"
    ].join(';')+';');
    const expected=sourceReferenceOracle({
      categories:[
        {'Category ID':'CAT-A','Category Name':'Electrical',Status:'Active'},
        {'Category ID':'CAT-B','Category Name':'Old',Status:'Inactive'},
        {'Category ID':'CAT-C','Category Name':'Electrical',Status:'Active'},
        {'Category ID':'CAT-D','Category Name':'Lower case',Status:'inactive'}
      ],
      units:[
        {'Unit ID':'UNT-A','Unit Name':'Pcs',Status:'Active'},
        {'Unit ID':'UNT-B','Unit Name':'Retired',Status:'Inactive'},
        {'Unit ID':'UNT-C','Unit Name':'Feet',Status:'Active'}
      ],
      settings:{'Currency Symbol':'৳','Low Stock Threshold':'8'}
    });
    const reader=createProductMasterOptionsReader(t.env);
    const result=await reader.getBootstrapReferences();
    assert.deepEqual(result,expected);
    assert.deepEqual(Object.keys(result),[
      'categories','units','currencySymbol','lowStockThreshold'
    ]);
    assert.equal(JSON.stringify(result).includes('KEEP-PRIVATE'),false);
    assert.equal(JSON.stringify(result).includes('01711111111'),false);
    assert(t.statements.every(sql=>/^SELECT\b/i.test(sql)));
    assert(t.statements.every(sql=>/LIMIT\s+\?/i.test(sql)));
    assert(t.statements.every(sql=>!/SELECT \*/i.test(sql)));
  }finally{t.db.close();}
});

test('source threshold falls back on empty, zero and invalid values, but keeps valid negative as original',async()=>{
  const t=fixture();
  try{
    const reader=createProductMasterOptionsReader(t.env);
    const missing=await reader.getBootstrapReferences();
    assert.equal(missing.currencySymbol,'');
    assert.equal(missing.lowStockThreshold,5);
    for(const [raw,expected] of [
      ['0',5],['',5],['not-a-number',5],[' 12 ',12],['-2',-2]
    ]){
      t.db.exec("DELETE FROM settings;");
      t.db.prepare('INSERT INTO settings(key,value) VALUES(?,?)')
        .run('Low Stock Threshold',raw);
      const actual=await reader.getBootstrapReferences();
      assert.equal(actual.lowStockThreshold,expected,JSON.stringify({raw}));
    }
  }finally{t.db.close();}
});

test('Settings read failure and invalid source identity fail closed without partial bootstrap',async()=>{
  const t=fixture();
  try{
    const failing={DB:{prepare(sql){
      if(sql.includes('FROM settings'))return {bind:()=>({
        all:async()=>({success:false,results:[]})
      })};
      return t.env.DB.prepare(sql);
    }}};
    await assert.rejects(
      ()=>createProductMasterOptionsReader(failing).getBootstrapReferences(),
      /Settings|D1|result/i
    );
    t.db.exec(
      "INSERT INTO settings(key,value) VALUES('prototype','blocked')"
    );
    await assert.rejects(
      ()=>createProductMasterOptionsReader(t.env).getBootstrapReferences(),
      /unsafe|Settings|invalid/i
    );
  }finally{t.db.close();}
});

test('original getOptions remains strictly two catalog reads, never fetches Settings',async()=>{
  const t=fixture();
  try{
    t.db.exec("INSERT INTO settings(key,value) VALUES('Currency Symbol','৳')");
    const reader=createProductMasterOptionsReader(t.env);
    assert.deepEqual(Object.keys(await reader.getOptions()),['categories','units']);
    assert.equal(t.statements.length,2);
    assert.equal(t.statements.some(sql=>sql.includes('settings')),false);
  }finally{t.db.close();}
});
