import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import {projectPurchaseDetail} from '../src/modules/purchase-detail-projection.js';

const sourceManagement=readFileSync(new URL('../legacy/source/PurchaseManagement.gs',import.meta.url),'utf8');
const sourceLots=readFileSync(new URL('../legacy/source/StockLots.gs',import.meta.url),'utf8');

function originalDeclaration(source,name){
  const node=parse(source,{ecmaVersion:'latest',sourceType:'module'}).body
    .find(x=>x.type==='FunctionDeclaration'&&x.id.name===name);
  assert.ok(node,'Pinned source function missing: '+name);
  return source.slice(node.start,node.end);
}
const nativeDetail=originalDeclaration(sourceManagement,'getPurchaseDetail');
const nativeLotPrice=originalDeclaration(sourceLots,'lotSellPrice_');
const clean=x=>JSON.parse(JSON.stringify(x));

function data(){
  return {
    purchases:[{
      'Purchase ID':'PUR-001','Date':'2026-11-05','Supplier ID':'SUP-1',
      'Supplier Name':'Local Supplier','Subtotal':'80.00','Discount':'2.00',
      'Grand Total':'78.00','Paid Amount':'10.00','Due Amount':'68.00',
      'Payment Status':'Partial','Payment Method':'Bank','Bank Account Name':'City Bank',
      'Notes':'Stock replenishment','Created By':'Staff A','Is Deleted':'FALSE'
    },{
      'Purchase ID':'PUR-OTHER','Date':'2026-11-04','Supplier ID':'SUP-OTHER',
      'Supplier Name':'Other','Grand Total':'99','Is Deleted':'FALSE'
    }],
    items:[
      {'Purchase ID':'PUR-001','Product ID':'P-1','Product Name':'Cable','Quantity':'2','Unit Price':'20','Sell Price':'29.00','Line Total':'40.00'},
      {'Purchase ID':'PUR-001','Product ID':'P-2','Product Name':'Switch','Quantity':'1','Unit Price':'25','Sell Price':'','Line Total':'25.00'},
      {'Purchase ID':'PUR-001','Product ID':'P-3','Product Name':'Socket','Quantity':'1','Unit Price':'15','Line Total':'15.00'},
      {'Purchase ID':'PUR-OTHER','Product ID':'P-1','Product Name':'Wrong','Quantity':'99','Unit Price':'3','Sell Price':'4','Line Total':'297'}
    ],
    products:[
      {'Product ID':'P-1','Selling Price':'35'},
      {'Product ID':'P-2','Selling Price':'45.00'},
      {'Product ID':'P-3','Selling Price':'21.25'}
    ],
    lots:[
      {'Lot ID':'LOT-1','Purchase ID':'PUR-001','Product ID':'P-1','Sell Price':'31'},
      {'Lot ID':'LOT-2','Purchase ID':'PUR-001','Product ID':'P-2','Sell Price':'38.50'},
      {'Lot ID':'LOT-OTHER','Purchase ID':'PUR-OTHER','Product ID':'P-3','Sell Price':'99.00'}
    ],
    returns:[
      {'Purchase ID':'PUR-001','Total Return Amount':'5.00','Is Deleted':'FALSE'},
      {'Purchase ID':'PUR-001','Total Return Amount':'200','Is Deleted':'TRUE'},
      {'Purchase ID':'PUR-OTHER','Total Return Amount':'100','Is Deleted':'FALSE'}
    ],
    settlement:{paidAmount:55,dueAmount:23,paymentStatus:'Partial'}
  };
}

function native(purchaseId,rows){
  const store={
    PURCHASES:rows.purchases,PURCHASE_ITEMS:rows.items,PRODUCTS:rows.products,
    STOCK_LOTS:rows.lots,PURCHASE_RETURN:rows.returns
  };
  const context={
    requirePermission_:()=>true,
    findFirstRow_:(key,idField,id)=>store[key].find(row=>row[idField]===id),
    getAllRows_:key=>store[key],
    activeRows_:key=>store[key].filter(row=>String(row['Is Deleted']||'').toUpperCase()!=='TRUE'),
    isDeleted_:row=>String(row['Is Deleted']||'').toUpperCase()==='TRUE',
    safeDateOnly_:date=>date?String(date).slice(0,10):'',
    isValidNonNegativeNumber_:value=>Number.isFinite(Number(value))&&Number(value)>=0,
    supplierPurchaseSettlementSnapshot_:()=>rows.settlement||null,
    ok_:value=>({success:true,data:value}),
    fail_:error=>({success:false,error}),
    logError_:()=>{}
  };
  vm.createContext(context);
  vm.runInContext(nativeLotPrice+'\n'+nativeDetail,context);
  return clean(context.getPurchaseDetail('authorized-token',purchaseId));
}
const projected=(id,rows)=>projectPurchaseDetail(id,{
  purchases:rows.purchases,items:rows.items,products:rows.products,
  lots:rows.lots,returns:rows.returns,settlement:rows.settlement
});

test('source parity: exact purchase detail fields, selected Supplier ID and multi-item prices',()=>{
  const rows=data();
  const old=native('PUR-001',rows);
  assert.equal(old.success,true);
  assert.deepEqual(projected('PUR-001',rows),old.data);
  assert.equal(old.data.supplierId,'SUP-1');
  assert.deepEqual(old.data.items.map(x=>x.sellingPrice),[29,38.5,21.25]);
  assert.deepEqual(old.data.items.map(x=>x.productId),['P-1','P-2','P-3']);
});

test('source parity: original paid and due if settlement snapshot absent, and defaults for optional fields',()=>{
  const rows=data();
  rows.settlement=null;
  rows.purchases[0]['Payment Method']='';
  rows.purchases[0]['Bank Account Name']='';
  rows.purchases[0]['Created By']='';
  rows.purchases[0]['Notes']='';
  const old=native('PUR-001',rows);
  assert.deepEqual(projected('PUR-001',rows),old.data);
  assert.equal(old.data.paidAmount,10);
  assert.equal(old.data.dueAmount,68);
  assert.equal(old.data.paymentMethod,'Cash');
});

test('source parity: returns only active matching purchase; net amount never auto-nets another Party account',()=>{
  const rows=data();
  const old=native('PUR-001',rows);
  assert.deepEqual(projected('PUR-001',rows),old.data);
  assert.equal(old.data.returnedAmount,5);
  assert.equal(old.data.netPurchase,73);
  assert.equal(old.data.paidAmount,55);
  assert.equal(old.data.dueAmount,23);
});

test('source parity: item null Sell Price retains original zero behavior, blank lot Sell Price falls back to product',()=>{
  const rows=data();
  rows.items[0]['Sell Price']=null;
  rows.lots[1]['Sell Price']='';
  const old=native('PUR-001',rows);
  assert.deepEqual(projected('PUR-001',rows),old.data);
  assert.deepEqual(old.data.items.map(x=>x.sellingPrice),[0,45,21.25]);
});

test('source error parity: missing and soft-deleted purchase produce original messages',()=>{
  const rows=data();
  assert.deepEqual(native('PUR-NOPE',rows),{success:false,error:'Purchase not found.'});
  assert.throws(()=>projected('PUR-NOPE',rows),/Purchase not found\./);
  rows.purchases[0]['Is Deleted']='TRUE';
  assert.deepEqual(native('PUR-001',rows),{success:false,error:'This purchase has been deleted.'});
  assert.throws(()=>projected('PUR-001',rows),/This purchase has been deleted\./);
});

test('intentional safety hardening: ambiguous legacy duplicate purchase IDs are refused, never guessed',()=>{
  const rows=data();
  rows.purchases.push({...rows.purchases[0], 'Supplier ID':'SUP-MISMATCH'});
  // The frozen GAS findFirstRow_ selected the first row; D1 account readback
  // must fail closed until M02 repairs the duplicate source identity.
  assert.equal(native('PUR-001',rows).success,true);
  assert.throws(()=>projected('PUR-001',rows),/Duplicate purchase ID detected/);
});

test('read projection never mutates source snapshots or emits write commands',()=>{
  const rows=data();
  const before=clean(rows);
  const result=projected('PUR-001',rows);
  assert.deepEqual(rows,before);
  assert.equal('operationId' in result,false);
  assert.equal('journal' in result,false);
  assert.equal('partyNet' in result,false);
});
