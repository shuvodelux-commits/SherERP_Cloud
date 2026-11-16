import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {projectProductsBootstrap} from '../src/modules/m05-product-bootstrap-valuation.js';

const frozenProducts=readFileSync(new URL('../legacy/source/Products.gs',import.meta.url),'utf8');
const frozenBundles=readFileSync(new URL('../legacy/source/Bundles.gs',import.meta.url),'utf8');
function original(source,name){
  const d=parse(source,{ecmaVersion:'latest',sourceType:'script'}).body.find(
    n=>n.type==='FunctionDeclaration'&&n.id.name===name);
  assert.ok(d,'Frozen GAS function missing: '+name);
  return source.slice(d.start,d.end);
}
const bundleHelpers=[
  'bundleProductType_','bundleProductMap_','validateBundleDefinition_',
  'getBundleDefinitions_','getStoredBundleDefinition_','getBundleAvailability_'
].map(name=>original(frozenBundles,name)).join('\n');
const nativeSource=bundleHelpers+'\n'+original(frozenProducts,'getProductsBootstrap');
const clean=x=>JSON.parse(JSON.stringify(x));
const p=(id,stock,price,other={})=>({
  'Product ID':id,'Product Name':id,'Current Stock':stock,
  'Purchase Price':price,'Selling Price':15,'Status':'Active',
  'Unit':'Pcs','Category':'Hardware','Product Type':'Standard',
  'Is Deleted':'FALSE',...other
});
const lot=(id,productId,source,qty,cost,other={})=>({
  'Lot ID':id,'Product ID':productId,'Purchase ID':source,
  'Remaining Quantity':qty,'Purchase Price':cost,'Status':'Active',...other
});
const recipe=(bundleId,productId,qty,other={})=>({
  'Bundle Product ID':bundleId,'Revision':2,'Status':'Active',
  'Component Product ID':productId,'Quantity Per Set':qty,'Unit':'Pcs',...other
});
const category=(id,other={})=>({
  'Category ID':id,'Category Name':id,'Status':'Active',...other
});
const unit=(id,other={})=>({
  'Unit ID':id,'Unit Name':id,'Status':'Active',...other
});
const fixture=()=>({
  productRows:[
    p('P-LOT',12,11),p('P-COMP',5,20),p('P-NEG',-2,4),
    p('P-FREE',10,100),p('P-INACTIVE',1,3,{Status:'Inactive'}),
    p('B-SET',88,75,{'Product Type':'Bundle','Bundle Revision':2}),
    p('P-DELETED',8,5,{'Is Deleted':'TRUE'})
  ],
  stockLots:[
    lot('L-1','P-LOT','PUR-1',5,30),
    lot('L-2','P-LOT','OPENING',3,0),
    lot('L-3','P-LOT','ADJUSTMENT-BATCH',1,0),
    lot('L-4','P-COMP','PUR-2',6,20),
    lot('L-FREE','P-FREE','PUR-FREE',10,0),
    lot('L-DELETED','P-DELETED','PUR-3',7,30)
  ],
  bundleComponentRows:[
    recipe('B-SET','P-LOT',4),
    recipe('B-SET','P-COMP',2)
  ],
  categoryRows:[category('CAT-A'),category('CAT-I',{Status:'Inactive'}),
    category('CAT-SOFT',{'Is Deleted':'TRUE'})],
  unitRows:[unit('UNIT-A'),unit('UNIT-I',{Status:'Inactive'})],
  settings:{'Currency Symbol':'৳','Low Stock Threshold':'4'}
});
function native(snapshot) {
  let authorization=0;
  const groups={
    STOCK_LOTS:snapshot.stockLots,PRODUCT_CATEGORIES:snapshot.categoryRows,
    PRODUCT_UNITS:snapshot.unitRows,BUNDLE_COMPONENTS:snapshot.bundleComponentRows,
    PRODUCTS:snapshot.productRows
  };
  const context=vm.createContext({
    requirePermission_:(token,group,action)=>{
      assert.deepEqual([token,group,action],['TRUSTED-TOKEN','products','view']);
      authorization++;
    },
    activeRows_:group=>{
      assert.equal(group,'PRODUCTS');
      return groups[group].filter(row=>row['Is Deleted']!==true &&
        String(row['Is Deleted']||'').toUpperCase()!=='TRUE');
    },
    getAllRows_:group=>{
      assert.ok(Object.hasOwn(groups,group),'Unknown source sheet '+group);
      return groups[group];
    },
    getSettingsMap_:()=>snapshot.settings,
    ok_:data=>({success:true,data}),
    fail_:message=>({success:false,message}),
    logError_:()=>{}
  });
  vm.runInContext(nativeSource,context);
  const result=clean(context.getProductsBootstrap('TRUSTED-TOKEN'));
  assert.equal(authorization,1);
  assert.equal(result.success,true,result.message);
  return result.data;
}
const projected=s=>projectProductsBootstrap(s);

test('complete Products Bootstrap matches frozen GAS with products, bundle, categories and settings',()=>{
  const input=fixture(),before=structuredClone(input);
  const actual=projected(input);
  assert.deepEqual(actual,native(input));
  assert.deepEqual(Object.keys(actual),
    ['products','categories','units','currencySymbol','lowStockThreshold']);
  assert.deepEqual(actual.products.map(p=>p['Product ID']),
    ['P-LOT','P-COMP','P-NEG','P-FREE','P-INACTIVE','B-SET']);
  assert.deepEqual(before,input,'source read snapshots are never mutated');
});

test('unpriced internal opening and adjustment lots plus missing stock receive display fallback',()=>{
  const input=fixture(),out=projected(input);
  const p=out.products.find(row=>row['Product ID']==='P-LOT');
  assert.equal(p['Stock Value'],227,'150 purchased + (3 opening + 1 adjustment + 3 gap) * 11');
  assert.equal(p['Unpriced Lot Count'],2);
  assert.equal(p['Unpriced Remaining Quantity'],4);
  assert.deepEqual(out,native(input));
});

test('genuine zero-cost purchase stays free, with no internal-source pricing override',()=>{
  const s=fixture(),p=projected(s).products.find(x=>x['Product ID']==='P-FREE');
  assert.equal(p['Stock Value'],0);
  assert.equal(p['Unpriced Lot Count'],0);
  assert.equal(p['Unpriced Remaining Quantity'],0);
  assert.deepEqual(projected(s),native(s));
});

test('overrepresented lot quantity does not silently hide historical valuation mismatch',()=>{
  const s=fixture(),out=projected(s);
  const product=out.products.find(x=>x['Product ID']==='P-COMP');
  assert.equal(product['Stock Value'],120,'6 lots of 20 despite Current Stock 5');
  s.stockLots.push(lot('L-COMP-OPEN','P-COMP','OPENING',1,0));
  assert.equal(projected(s).products.find(x=>x['Product ID']==='P-COMP')['Stock Value'],120);
  assert.deepEqual(projected(s),native(s));
});

test('no-lot negative stock retains source negative value without fake extra lot',()=>{
  const s=fixture(),product=projected(s).products.find(p=>p['Product ID']==='P-NEG');
  assert.equal(product['Stock Value'],-8);
  assert.equal(product['Unpriced Lot Count'],0);
  assert.deepEqual(projected(s),native(s));
});

test('valid bundle uses component availability, not bundle own Current Stock or assigned price',()=>{
  const s=fixture(),bundle=projected(s).products.find(x=>x['Product ID']==='B-SET');
  assert.equal(bundle['Product Type'],'Bundle');
  assert.equal(bundle['Stock Value'],0);
  assert.equal(bundle['Available Sets'],2);
  assert.equal(bundle['Bundle Error'],'');
  assert.deepEqual(bundle['Bundle Components'],[
    {productId:'P-LOT',qtyPerSet:4,unit:'Pcs'},
    {productId:'P-COMP',qtyPerSet:2,unit:'Pcs'}
  ]);
  assert.deepEqual(projected(s),native(s));
});

test('invalid or absent bundle recipe keeps source error and historical stored revision',()=>{
  const missing=fixture();
  missing.bundleComponentRows=[];
  const a=projected(missing).products.find(x=>x['Product ID']==='B-SET');
  assert.match(a['Bundle Error'],/Bundle recipe unavailable/);
  assert.equal(a['Available Sets'],0);
  assert.deepEqual(a['Bundle Components'],[]);
  assert.deepEqual(projected(missing),native(missing));
  const inactive=fixture();
  inactive.productRows.find(x=>x['Product ID']==='P-COMP').Status='Inactive';
  const b=projected(inactive).products.find(x=>x['Product ID']==='B-SET');
  assert.match(b['Bundle Error'],/Bundle component must be active/);
  assert.equal(b['Available Sets'],0);
  assert.equal(b['Bundle Components'].length,2,'source returns stored component snapshot');
  assert.deepEqual(projected(inactive),native(inactive));
  const duplicate=fixture();
  duplicate.bundleComponentRows.push(recipe('B-SET','P-LOT',2));
  const c=projected(duplicate).products.find(x=>x['Product ID']==='B-SET');
  assert.match(c['Bundle Error'],/A component appears more than once/);
  assert.deepEqual(projected(duplicate),native(duplicate));
});

test('source includes inactive product and soft-deleted category, but not soft-deleted products',()=>{
  const s=fixture(),v=projected(s);
  assert.ok(v.products.some(x=>x['Product ID']==='P-INACTIVE'));
  assert.ok(!v.products.some(x=>x['Product ID']==='P-DELETED'));
  assert.deepEqual(v.categories.map(x=>x.id),['CAT-A','CAT-SOFT']);
  assert.deepEqual(v.units.map(x=>x.id),['UNIT-A']);
  assert.deepEqual(v,native(s));
});

test('source retains zero-cost internal flag and counts even if status is Deleted',()=>{
  const s=fixture();
  s.stockLots.find(x=>x['Lot ID']==='L-2').Status='Deleted';
  assert.deepEqual(projected(s),native(s),'original getAllRows_ includes historical lot status');
  assert.equal(projected(s).products.find(x=>x['Product ID']==='P-LOT')['Unpriced Lot Count'],2);
});

test('settings preserve original low-stock and currency default coercion',()=>{
  const s=fixture();
  s.settings={'Low Stock Threshold':0,'Currency Symbol':''};
  const a=projected(s);
  assert.equal(a.lowStockThreshold,5);
  assert.equal(a.currencySymbol,'');
  assert.deepEqual(a,native(s));
});

test('missing arrays, malformed rows and accessor-backed input are rejected',()=>{
  const s=fixture();
  assert.throws(()=>projected(null),/snapshot/i);
  assert.throws(()=>projected({...s,stockLots:null}),/stockLots.*snapshot/i);
  assert.throws(()=>projected({...s,productRows:[new Date()]}),/productRows.*row/i);
  const getter=Object.defineProperty({},'Remaining Quantity',{
    get(){throw Error('MUST NOT RUN');}
  });
  assert.throws(()=>projected({...s,stockLots:[getter]}),/stockLots.*row|accessor/i);
  const settings=Object.defineProperty({},'Currency Symbol',{get(){throw Error('MUST NOT RUN')}});
  assert.throws(()=>projected({...s,settings}),/settings|accessor/i);
});

test('ambiguous duplicate product, lot and selector IDs block source import rather than guessing',()=>{
  const s=fixture();
  s.productRows.push(p('P-LOT',11,20));
  assert.throws(()=>projected(s),/duplicate.*product id/i);
  s.productRows.pop();
  s.stockLots.push(lot('L-1','P-LOT','PUR-1',2,20));
  assert.throws(()=>projected(s),/duplicate.*lot id/i);
  s.stockLots.pop();
  s.categoryRows.push(category('CAT-A'));
  assert.throws(()=>projected(s),/duplicate.*category id/i);
});

test('nonfinite and nonprimitive source stock and lot numbers fail closed',()=>{
  const s=fixture();
  s.productRows[0]['Current Stock']='Infinity';
  assert.throws(()=>projected(s),/invalid.*stock/i);
  s.productRows[0]['Current Stock']=12;
  s.stockLots[0]['Remaining Quantity']={value:5};
  assert.throws(()=>projected(s),/invalid.*remaining/i);
});

test('internal product bootstrap cannot call Worker RPC, mutate D1 or post stock',()=>{
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const implementation=readFileSync(new URL('../src/modules/m05-product-bootstrap-valuation.js',import.meta.url),'utf8');
  assert.doesNotMatch(worker,/projectProductsBootstrap|m05-product-bootstrap-valuation/);
  assert.doesNotMatch(implementation,/SpreadsheetApp|LockService|\bfetch\s*\(|\.batch\s*\(|\.run\s*\(|\.put\s*\(/);
});
