import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import {projectPurchaseForUpdate} from '../src/modules/m05-purchase-update-read.js';

const sourceManagement=readFileSync(new URL('../legacy/source/PurchaseManagement.gs',import.meta.url),'utf8');
const sourceLots=readFileSync(new URL('../legacy/source/StockLots.gs',import.meta.url),'utf8');
function extract(source,name) {
  const declaration=parse(source,{ecmaVersion:'latest',sourceType:'script'}).body
    .find(x=>x.type==='FunctionDeclaration'&&x.id.name===name);
  assert.ok(declaration,'Frozen source declaration missing: '+name);
  return source.slice(declaration.start,declaration.end);
}
const nativeSource=[
  extract(sourceLots,'lotSellPrice_'),
  extract(sourceManagement,'getPurchaseForUpdate')
].join('\n');
const plain=x=>JSON.parse(JSON.stringify(x));

const purchase=(id='PUR-1',extra={})=>({
  'Purchase ID':id,'Date':'2026-11-11','Supplier ID':'SUP-A',
  'Supplier Name':'Original Supplier','Discount':'5.50',
  'Paid Amount':'12','Payment Method':'Mobile Banking',
  'Bank Account ID':'BA-22','Notes':'Original note','Is Deleted':'FALSE',...extra
});
const item=(productId,quantity,price,sellPrice,extra={})=>({
  'Purchase ID':'PUR-1','Product ID':productId,'Product Name':productId,
  'Quantity':quantity,'Unit Price':price,
  ...(sellPrice===undefined?{}:{'Sell Price':sellPrice}),...extra
});
const product=(id,sellPrice)=>({'Product ID':id,'Selling Price':sellPrice});
const lot=(id,productId,sellPrice,extra={})=>({
  'Lot ID':id,'Purchase ID':'PUR-1','Product ID':productId,
  'Sell Price':sellPrice,...extra
});
const fixture=()=>({
  purchases:[purchase(),purchase('PUR-OTHER',{'Supplier ID':'SUP-B'})],
  items:[
    item('P-STORED',2,'17.5',0),
    item('P-LOT',3,'12.25',''),
    item('P-PRODUCT',1,'2.5',null),
    item('P-MISSING',2,1,undefined)
  ],
  products:[
    product('P-STORED',99),
    product('P-LOT',75),
    product('P-PRODUCT','41.75')
  ],
  lots:[
    lot('LOT-1','P-STORED',45),
    lot('LOT-2','P-LOT','30.5'),
    lot('LOT-OUT','P-PRODUCT',150,{'Purchase ID':'PUR-OTHER'})
  ],
  returns:[
    {'Return ID':'RET-OLD','Purchase ID':'PUR-1','Is Deleted':'TRUE'},
    {'Return ID':'RET-OTHER','Purchase ID':'PUR-OTHER','Is Deleted':'FALSE'}
  ]
});
function native(rows,id='PUR-1') {
  const store={
    PURCHASES:rows.purchases,PURCHASE_ITEMS:rows.items,
    PRODUCTS:rows.products,STOCK_LOTS:rows.lots,
    PURCHASE_RETURN:rows.returns
  };
  let authCount=0;
  const context=vm.createContext({
    requirePermission_:(token,module,action)=>{
      assert.deepEqual([token,module,action],['verified-token','purchase','edit']);
      authCount++;
    },
    findFirstRow_:(group,key,value)=>store[group].find(row=>row[key]===value),
    getAllRows_:group=>store[group],
    activeRows_:group=>store[group].filter(row=>String(row['Is Deleted']||'').toUpperCase()!=='TRUE'),
    isDeleted_:row=>String(row['Is Deleted']||'').toUpperCase()==='TRUE',
    safeDateOnly_:value=>value?String(value).slice(0,10):'',
    isValidNonNegativeNumber_:value=>Number.isFinite(Number(value))&&Number(value)>=0,
    ok_:data=>({success:true,data}),
    fail_:message=>({success:false,message}),
    logError_:()=>{}
  });
  vm.runInContext(nativeSource,context);
  const result=plain(context.getPurchaseForUpdate('verified-token',id));
  assert.equal(authCount,1);
  return result;
}
const project=(rows=fixture(),id='PUR-1')=>projectPurchaseForUpdate(id,rows);

test('source parity: exact update form, source item order, stored 0 / lot / product / 0 prices',()=>{
  const snapshot=fixture(),before=structuredClone(snapshot);
  const expected=native(snapshot);
  assert.equal(expected.success,true);
  const actual=project(snapshot);
  assert.deepEqual(actual,expected.data);
  assert.deepEqual(Object.keys(actual),[
    'purchaseId','date','supplierId','supplierName','discount','paidAmount',
    'paymentMethod','bankAccountId','notes','items'
  ]);
  assert.deepEqual(actual.items.map(row=>row.sellingPrice),[0,30.5,41.75,0]);
  assert.deepEqual(actual.items.map(row=>row.productId),
    ['P-STORED','P-LOT','P-PRODUCT','P-MISSING']);
  assert.deepEqual(snapshot,before,'projection cannot mutate source rows');
});

test('source parity: Cash fallback only for a paid purchase with empty stored method',()=>{
  const rows=fixture();
  rows.purchases[0]['Payment Method']='';
  assert.equal(project(rows).paymentMethod,'Cash');
  assert.deepEqual(project(rows),native(rows).data);
  rows.purchases[0]['Paid Amount']=0;
  assert.equal(project(rows).paymentMethod,'');
  assert.deepEqual(project(rows),native(rows).data);
});

test('bank fields are source snapshots, not new authorization or account selection',()=>{
  const rows=fixture();
  rows.purchases[0]['Payment Method']='Bank';
  rows.purchases[0]['Bank Account ID']='LEGACY-INACTIVE-ACCOUNT';
  assert.equal(project(rows).bankAccountId,'LEGACY-INACTIVE-ACCOUNT');
  assert.deepEqual(project(rows),native(rows).data);
});

test('deleted purchase or active return blocks update; soft-deleted return is ignored',()=>{
  const rows=fixture();
  assert.equal(project(rows).purchaseId,'PUR-1');
  rows.returns.push({'Return ID':'RET-ACTIVE','Purchase ID':'PUR-1','Is Deleted':'FALSE'});
  assert.equal(native(rows).success,false);
  assert.throws(()=>project(rows),/Purchase Return records.*can no longer be updated/);
  rows.returns.pop();
  rows.purchases[0]['Is Deleted']='TRUE';
  assert.equal(native(rows).success,false);
  assert.throws(()=>project(rows),/This purchase has been deleted/);
});

test('unknown purchase ID fails with source message, never invents an editable invoice',()=>{
  const rows=fixture();
  assert.equal(native(rows,'PUR-MISSING').success,false);
  assert.throws(()=>project(rows,'PUR-MISSING'),/Purchase not found/);
});

test('duplicate purchase header and ambiguous purchase item or stock lot must fail closed',()=>{
  const rows=fixture();
  rows.purchases.push(purchase());
  assert.throws(()=>project(rows),/duplicate purchase id/i);
  rows.purchases.pop();
  rows.items.push(item('P-LOT',1,2,8));
  assert.throws(()=>project(rows),/duplicate.*product.*line/i);
  rows.items.pop();
  rows.lots.push(lot('LOT-DUP','P-LOT',45));
  assert.throws(()=>project(rows),/multiple.*stock lot/i);
});

test('products and lots with other purchase IDs never override source purchase item prices',()=>{
  const rows=fixture();
  rows.lots.push(lot('LOT-OTHER-2','P-PRODUCT',200,{'Purchase ID':'PUR-OTHER'}));
  assert.deepEqual(project(rows),native(rows).data);
  assert.equal(project(rows).items.find(row=>row.productId==='P-PRODUCT').sellingPrice,41.75);
});

test('invalid imported date, missing IDs, invalid price or zero line quantity blocks unsafe edit',()=>{
  const rows=fixture();
  rows.purchases[0].Date='2026-11-31';
  assert.throws(()=>project(rows),/invalid.*date/i);
  rows.purchases[0].Date='2026-11-11T04:00:00Z';
  assert.throws(()=>project(rows),/canonical.*date/i);
  rows.purchases[0].Date='2026-11-11';
  rows.items[0]['Product ID']='';
  assert.throws(()=>project(rows),/missing.*product id/i);
  rows.items[0]['Product ID']='P-STORED';
  rows.items[0].Quantity=0;
  assert.throws(()=>project(rows),/invalid.*quantity/i);
  rows.items[0].Quantity=2;
  rows.items[0]['Unit Price']='Infinity';
  assert.throws(()=>project(rows),/invalid.*unit price/i);
});

test('trusted source snapshot validation rejects missing arrays and accessors without executing getters',()=>{
  assert.throws(()=>projectPurchaseForUpdate('PUR-1',null),/snapshot/i);
  assert.throws(()=>projectPurchaseForUpdate('PUR-1',{...fixture(),lots:null}),/snapshot/i);
  assert.throws(()=>projectPurchaseForUpdate('PUR-1',{...fixture(),purchases:[new Date()]}),/row/i);
  const malicious=Object.defineProperty({},'Product ID',{get(){throw Error('GETTER MUST NOT RUN');}});
  assert.throws(()=>projectPurchaseForUpdate('PUR-1',{...fixture(),products:[malicious]}),
    /row|accessor/i);
});

test('module has no public RPC, D1, Cash Session or payment posting side effects',()=>{
  const source=readFileSync(new URL('../src/modules/m05-purchase-update-read.js',import.meta.url),'utf8');
  const routing=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(routing,/projectPurchaseForUpdate|m05-purchase-update-read/);
  assert.doesNotMatch(source,/SpreadsheetApp|LockService|\bfetch\s*\(|\.batch\s*\(|\.run\s*\(|\.put\s*\(/);
});
