import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {projectPurchaseBootstrap} from '../src/modules/m05-purchase-bootstrap-read.js';

const frozen={
  purchase:readFileSync(new URL('../legacy/source/Purchase.gs',import.meta.url),'utf8'),
  utils:readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8'),
  bank:readFileSync(new URL('../legacy/source/BankAccounts.gs',import.meta.url),'utf8')
};
function extract(source,name){
  const declaration=parse(source,{ecmaVersion:'latest',sourceType:'script'}).body.find(
    node=>node.type==='FunctionDeclaration'&&node.id.name===name
  );
  assert.ok(declaration,'Pinned GAS function required: '+name);
  return source.slice(declaration.start,declaration.end);
}
const sourceRuntime=[
  "const BANK_LIKE_PAYMENT_METHODS=['Bank','Mobile Banking'];",
  extract(frozen.bank,'sanitizeAccountType_'),
  extract(frozen.utils,'getActiveBankAccountsForUI_'),
  extract(frozen.purchase,'getPurchaseBootstrap')
].join('\n');

const product=(id,extra={})=>({
  'Product ID':id,'Product Name':'Copper wire',Brand:'Electric Co',
  Unit:'Pcs',Category:'Electrical',Barcode:'001203','Current Stock':'4',
  'Purchase Price':'10.50','Selling Price':'15.75',Status:'Active',...extra
});
const supplier=(id,extra={})=>({
  'Supplier ID':id,'Supplier Name':'Supplier '+id,Phone:'01700000000',
  'Current Due':-25,Status:'Active',...extra
});
const category=(id,extra={})=>({
  'Category ID':id,'Category Name':'Electrical',Status:'Active',...extra
});
const bank=(id,extra={})=>({
  'Bank Account ID':id,'Account Name':'Bank '+id,
  'Account Type':'Bank',Status:'Active',...extra
});
const fixture=()=>({
  productRows:[
    product('P-1'),
    product('P-BUNDLE',{'Product Type':'Bundle','Current Stock':0}),
    product('P-INACTIVE',{Status:'Inactive'}),
    product('P-DELETED',{'Is Deleted':'TRUE'}),
    product('P-LOWER',{Status:'inactive','Current Stock':'-3'})
  ],
  supplierRows:[
    supplier('S-1'),supplier('S-2',{'Current Due':'125.50'}),
    supplier('S-INACTIVE',{Status:'Inactive'}),supplier('S-DELETED',{'Is Deleted':'TRUE'})
  ],
  categoryRows:[
    category('C-1'),category('C-INACTIVE',{Status:'Inactive'}),
    category('C-LEGACY-DELETED',{'Is Deleted':'TRUE'})
  ],
  bankAccountRows:[
    bank('B-1',{'Account Type':''}),
    bank('B-2',{'Account Type':'Mobile Banking'}),
    bank('B-INACTIVE',{Status:'Inactive'}),
    bank('B-LEGACY-DELETED',{'Is Deleted':'TRUE'})
  ],
  settings:{'Currency Symbol':'৳'}
});
function legacyBootstrap(snapshot) {
  let permissions=0;
  const mapping={
    PRODUCTS:snapshot.productRows,SUPPLIERS:snapshot.supplierRows,
    PRODUCT_CATEGORIES:snapshot.categoryRows,BANK_ACCOUNTS:snapshot.bankAccountRows
  };
  const context=vm.createContext({
    requirePermission_:(token,module,action)=>{
      assert.deepEqual([token,module,action],['SERVER-SESSION','purchase','view']);
      permissions++;
    },
    getAllRows_:name=>{
      assert.ok(Object.hasOwn(mapping,name),'Unexpected source GAS sheet '+name);
      return mapping[name];
    },
    activeRows_:name=>mapping[name].filter(
      row=>String(row['Is Deleted']||'').toUpperCase()!=='TRUE'
    ),
    getSettingsMap_:()=>snapshot.settings,
    ok_:data=>({success:true,data}),
    fail_:message=>({success:false,message}),
    logError_:()=>{}
  });
  vm.runInContext(sourceRuntime,context);
  const result=context.getPurchaseBootstrap('SERVER-SESSION');
  assert.equal(result.success,true,result.message);
  assert.equal(permissions,1);
  return JSON.parse(JSON.stringify(result.data));
}

test('source full Purchase Bootstrap equals frozen GAS fields, arrays and ordering',()=>{
  const snapshot=fixture(),before=structuredClone(snapshot);
  const actual=projectPurchaseBootstrap(snapshot);
  assert.deepEqual(actual,legacyBootstrap(snapshot));
  assert.deepEqual(Object.keys(actual),
    ['products','categories','suppliers','bankAccounts','currencySymbol']);
  assert.deepEqual(actual.products.map(row=>row.id),['P-1','P-BUNDLE','P-LOWER']);
  assert.deepEqual(actual.suppliers.map(row=>row.id),['S-1','S-2']);
  assert.deepEqual(actual.categories.map(row=>row.id),['C-1','C-LEGACY-DELETED']);
  assert.deepEqual(actual.bankAccounts.map(row=>row.id),['B-1','B-2','B-LEGACY-DELETED']);
  assert.deepEqual(snapshot,before,'read projector must never mutate source snapshots');
});

test('source product fields preserve trusted price strings, leading-zero barcode and negative stock',()=>{
  const snapshot=fixture();
  const result=projectPurchaseBootstrap(snapshot);
  assert.deepEqual(result.products[0],{
    id:'P-1',name:'Copper wire',brand:'Electric Co',unit:'Pcs',
    category:'Electrical',barcode:'001203',stock:4,
    purchasePrice:'10.50',sellingPrice:'15.75'
  });
  assert.equal(result.products[2].stock,-3);
  assert.deepEqual(result,legacyBootstrap(snapshot));
});

test('source supplier credits are negative; bootstrap never merges Party role accounts',()=>{
  const snapshot=fixture();
  const result=projectPurchaseBootstrap(snapshot);
  assert.equal(result.suppliers[0].currentDue,-25);
  assert.equal(result.suppliers[1].currentDue,125.5);
  assert.equal(result.suppliers[0].phone,'01700000000');
  assert.deepEqual(result,legacyBootstrap(snapshot));
});

test('legacy blank account type normalizes to Bank, Mobile Banking remains separate',()=>{
  const snapshot=fixture(),result=projectPurchaseBootstrap(snapshot);
  assert.deepEqual(result.bankAccounts,[
    {id:'B-1',name:'Bank B-1',type:'Bank'},
    {id:'B-2',name:'Bank B-2',type:'Mobile Banking'},
    {id:'B-LEGACY-DELETED',name:'Bank B-LEGACY-DELETED',type:'Bank'}
  ]);
  assert.deepEqual(result,legacyBootstrap(snapshot));
});

test('empty snapshots and unset currency preserve exact source fallbacks',()=>{
  const s={productRows:[],supplierRows:[],categoryRows:[],bankAccountRows:[],settings:{}};
  assert.deepEqual(projectPurchaseBootstrap(s),{
    products:[],categories:[],suppliers:[],bankAccounts:[],currencySymbol:''
  });
  assert.deepEqual(projectPurchaseBootstrap(s),legacyBootstrap(s));
});

test('source numeric stock coercion remains Number(value)||0; no posting arithmetic introduced',()=>{
  const snapshot=fixture();
  snapshot.productRows[0]['Current Stock']='not-a-number';
  snapshot.supplierRows[0]['Current Due']='bad';
  assert.equal(projectPurchaseBootstrap(snapshot).products[0].stock,0);
  assert.equal(projectPurchaseBootstrap(snapshot).suppliers[0].currentDue,0);
  assert.deepEqual(projectPurchaseBootstrap(snapshot),legacyBootstrap(snapshot));
});

test('duplicate active source IDs fail closed instead of exposing ambiguous selection',()=>{
  for(const [key,idField,build] of [
    ['productRows','Product ID',()=>product('P-1')],
    ['supplierRows','Supplier ID',()=>supplier('S-1')],
    ['categoryRows','Category ID',()=>category('C-1')],
    ['bankAccountRows','Bank Account ID',()=>bank('B-1')]
  ]) {
    const s=fixture();s[key].push(build());
    assert.throws(()=>projectPurchaseBootstrap(s),
      /duplicate.*id/i,'Duplicate '+idField+' must block import review');
  }
});

test('missing active ID blocks; inactive and soft-deleted duplicate IDs are not selectable',()=>{
  const s=fixture();
  s.productRows.push(product('P-INACTIVE',{Status:'Inactive'}));
  s.supplierRows.push(supplier('S-DELETED',{'Is Deleted':'TRUE'}));
  assert.doesNotThrow(()=>projectPurchaseBootstrap(s));
  s.productRows.push(product(''));
  assert.throws(()=>projectPurchaseBootstrap(s),/missing.*id/i);
});

test('untrusted malformed, accessor, and missing snapshots refuse to project',()=>{
  assert.throws(()=>projectPurchaseBootstrap(),/snapshot/i);
  assert.throws(()=>projectPurchaseBootstrap({...fixture(),productRows:null}),/snapshot/i);
  assert.throws(()=>projectPurchaseBootstrap({...fixture(),bankAccountRows:[new Date()]}),/row/i);
  const getter=Object.defineProperty({},'Supplier ID',{
    get(){throw new Error('unsafe accessor should not run');}
  });
  assert.throws(()=>projectPurchaseBootstrap({...fixture(),supplierRows:[getter]}),/row|accessor/i);
  assert.throws(()=>projectPurchaseBootstrap({...fixture(),settings:null}),/settings/i);
  const untrustedSettings=Object.defineProperty({},'Currency Symbol',{get(){throw Error('unsafe')}});
  assert.throws(()=>projectPurchaseBootstrap({...fixture(),settings:untrustedSettings}),/settings|accessor/i);
});

test('pure helper is not wired to unauthenticated public RPC and writes no stock or money',()=>{
  const code=readFileSync(new URL('../src/modules/m05-purchase-bootstrap-read.js',import.meta.url),'utf8');
  const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(worker,/projectPurchaseBootstrap|m05-purchase-bootstrap-read/);
  assert.doesNotMatch(code,/SpreadsheetApp|LockService|\bfetch\s*\(|\.batch\s*\(|\.run\s*\(|\.put\s*\(/);
});
