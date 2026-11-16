import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {parse} from 'acorn';
import {preparePurchasePreflight} from '../src/modules/purchase-preflight.js';
import {preparePurchasePaymentPreflight} from '../src/modules/m05-purchase-payment-preflight.js';

const utilsSource=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
const purchaseSource=readFileSync(new URL('../legacy/source/Purchase.gs',import.meta.url),'utf8');
const original=parse(utilsSource,{ecmaVersion:'latest',sourceType:'script'}).body;
function functionBody(name) {
  const declaration=original.find(x=>x.type==='FunctionDeclaration'&&x.id.name===name);
  assert.ok(declaration,'Pinned source function missing: '+name);
  return utilsSource.slice(declaration.start,declaration.end);
}
const bankFunctions=['sanitizeInput_','isBankLikePaymentMethod_','resolveBankAccount_']
  .map(functionBody).join('\n');
const products=[
  {'Product ID':'PR-1','Product Name':'Cable','Current Stock':5,'Product Type':'Standard',_rowIndex:7},
  {'Product ID':'PR-2','Product Name':'Switch','Current Stock':0,'Product Type':'Standard',_rowIndex:8},
  {'Product ID':'PR-BUNDLE','Product Name':'Bundle','Current Stock':0,'Product Type':'Bundle',_rowIndex:9},
  {'Product ID':'PR-DELETED','Product Name':'Retired','Is Deleted':'TRUE','Current Stock':2,_rowIndex:10}
];
const suppliers=[
  {'Supplier ID':'SUP-1','Supplier Name':'Supplier A',Status:'Active'},
  {'Supplier ID':'SUP-2','Supplier Name':'Supplier B',Status:'Inactive'}
];
const bankAccounts=[
  {'Bank Account ID':'BA-1','Account Name':'Main account','Account Type':'Bank',Status:'Active'},
  {'Bank Account ID':'BA-2','Account Name':'Retired mobile','Account Type':'Mobile Banking',Status:'Inactive'}
];
const line=(productId='PR-1',qty=3,unitPrice=20,sellingPrice=25)=>({
  productId,name:productId,qty,unitPrice,sellingPrice
});
const request=(extra={})=>({
  supplierId:'SUP-1',
  items:[line('PR-1',3,20,25),line('PR-2',2,5,8)],
  discount:5,paidAmount:20,...extra
});
const snapshots=()=>({products,suppliers,bankAccounts});
const preview=(payload=request(),rows=snapshots())=>preparePurchasePaymentPreflight(payload,rows);
const expectedPurchase=(payload)=>preparePurchasePreflight(payload,{products,suppliers});

function frozenResolve(method,accountId,accounts=bankAccounts){
  const context=vm.createContext({
    getAllRows_:table=>{
      assert.equal(table,'BANK_ACCOUNTS');
      return accounts;
    }
  });
  vm.runInContext("const BANK_LIKE_PAYMENT_METHODS = ['Bank', 'Mobile Banking'];\n"+bankFunctions,context);
  return JSON.parse(JSON.stringify(context.resolveBankAccount_(method,accountId)));
}

test('source-validated purchase total plus Bank payment resolves original bank account metadata',()=>{
  const payload=request({paymentMethod:'Bank',bankAccountId:' BA-1 '});
  const before=structuredClone({payload,products,suppliers,bankAccounts});
  const result=preview(payload);
  assert.equal(result.subtotal,70);
  assert.equal(result.grandTotal,65);
  assert.equal(result.paidAmount,20);
  assert.equal(result.dueAmount,45);
  assert.equal(result.paymentStatus,'Partial');
  assert.equal(result.paymentMethod,'Bank');
  assert.equal(result.bankAccountId,'BA-1');
  assert.equal(result.bankAccountName,'Main account');
  const {paymentMethod,bankAccountId,bankAccountName,...sourceResult}=result;
  assert.deepEqual(sourceResult,expectedPurchase(payload));
  assert.deepEqual({id:bankAccountId,name:bankAccountName},
    frozenResolve(paymentMethod,payload.bankAccountId));
  assert.deepEqual({payload,products,suppliers,bankAccounts},before);
});

test('Mobile Banking resolves even inactive historical account and does not cross-check account type',()=>{
  for(const entry of [
    {method:'Mobile Banking',bankId:'BA-2'},
    {method:'Bank',bankId:'BA-2'}
  ]) {
    const payload=request({paymentMethod:entry.method,bankAccountId:entry.bankId});
    const result=preview(payload);
    assert.equal(result.bankAccountId,'BA-2');
    assert.equal(result.bankAccountName,'Retired mobile');
    assert.deepEqual({id:result.bankAccountId,name:result.bankAccountName},
      frozenResolve(entry.method,entry.bankId));
  }
});

test('paid purchase defaults to Cash and clears any stale bank ID',()=>{
  const payload=request({bankAccountId:'BA-1'});
  const result=preview(payload);
  assert.equal(result.paymentMethod,'Cash');
  assert.equal(result.bankAccountId,'');
  assert.equal(result.bankAccountName,'');
  assert.deepEqual(frozenResolve('Cash','BA-1'),{id:'',name:''});
});

test('unpaid purchase ignores provided Bank or Mobile Banking account fields',()=>{
  for(const method of ['Bank','Mobile Banking']) {
    const payload=request({paymentMethod:method,bankAccountId:'MISSING',paidAmount:0});
    const result=preview(payload);
    assert.deepEqual([result.paymentMethod,result.bankAccountId,result.bankAccountName],['','','']);
    assert.equal(result.paymentStatus,'Due');
  }
});

test('discount and overpayment retain original purchase clamping, with source bank lookup',()=>{
  const payload=request({paymentMethod:'Bank',bankAccountId:'BA-1',paidAmount:999});
  const result=preview(payload);
  assert.equal(result.paidAmount,65);
  assert.equal(result.dueAmount,0);
  assert.equal(result.paymentStatus,'Paid');
  assert.equal(result.bankAccountId,'BA-1');
  assert.deepEqual(result.lines,expectedPurchase(payload).lines);
});

test('source bank errors reject absent or unknown account IDs without a fallback',()=>{
  for(const accountId of [null,'','   ','MISSING']) {
    const payload=request({paymentMethod:'Bank',bankAccountId:accountId});
    const expected=accountId===null||!String(accountId).trim()
      ?/Choose a bank account/i:/Bank account not found/i;
    assert.throws(()=>preview(payload),expected);
    assert.throws(()=>frozenResolve('Bank',accountId),expected);
  }
});

test('duplicate account IDs fail closed rather than inheriting legacy first-match ambiguity',()=>{
  const duplicated=[...bankAccounts,{'Bank Account ID':'BA-1','Account Name':'Other owner'}];
  assert.throws(()=>preview(request({paymentMethod:'Bank',bankAccountId:'BA-1'}),{
    ...snapshots(),bankAccounts:duplicated}),/duplicate bank account id/i);
  assert.equal(frozenResolve('Bank','BA-1',duplicated).name,'Main account',
    'frozen source picks first; new audit intentionally rejects ambiguity');
  assert.equal(preview(request(),{...snapshots(),bankAccounts:duplicated}).paymentMethod,
    'Cash','legacy Cash resolution does not need a bank lookup');
});

test('source non-bank method labels follow the non-bank path without inferred extra enums',()=>{
  for(const method of ['Cash','Card','Transfer']) {
    const result=preview(request({paymentMethod:method,bankAccountId:'BA-1'}));
    assert.deepEqual([result.paymentMethod,result.bankAccountId,result.bankAccountName],
      [method,'','']);
    assert.deepEqual(frozenResolve(method,'BA-1'),{id:'',name:''});
  }
});

test('original supplier/product validators remain untouched before bank payment resolution',()=>{
  const p=request({paymentMethod:'Bank',bankAccountId:'BA-1'});
  assert.throws(()=>preview({...p,supplierId:'SUP-2'}),/supplier not found or inactive/i);
  assert.throws(()=>preview({...p,items:[line('PR-BUNDLE')]}),/virtual bundle sets/i);
  assert.throws(()=>preview({...p,items:[line('PR-DELETED')]}),/no longer exists/i);
  assert.throws(()=>preview({...p,items:[line('PR-1',-1)]}),/quantity must be greater/i);
  assert.throws(()=>preview({...p,items:[line('PR-1'),line('PR-1')]}),/appears more than once/i);
});

test('malformed trusted snapshots or accessor records cannot influence account selection',()=>{
  assert.throws(()=>preview(request(),{...snapshots(),bankAccounts:null}),/snapshot/i);
  assert.throws(()=>preview(request(),{...snapshots(),bankAccounts:[new Date()]}),/account row/i);
  assert.throws(()=>preview(request(),{...snapshots(),products:null}),/product snapshot/i);
  const accessor=Object.defineProperty({},'Bank Account ID',{get(){throw Error('should not execute');}});
  assert.throws(()=>preview(request(),{...snapshots(),bankAccounts:[accessor]}),/account row|accessor/i);
});

test('pure helper neither bypasses Cash Session enforcement nor registers an RPC or posts money',()=>{
  const source=purchaseSource.slice(purchaseSource.indexOf('function createPurchase('));
  assert.match(source,/requireActiveCashSession_\(\);/);
  assert.ok(source.indexOf('requireActiveCashSession_();')<
    source.indexOf('resolveBankAccount_(paymentMethod, payload.bankAccountId)'),
    'frozen source Cash Session check precedes bank resolution');
  const runtime=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const code=readFileSync(new URL('../src/modules/m05-purchase-payment-preflight.js',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/preparePurchasePaymentPreflight|m05-purchase-payment-preflight/);
  assert.doesNotMatch(code,/SpreadsheetApp|LockService|\bfetch\s*\(|\.batch\s*\(|\.run\s*\(|\.put\s*\(/);
});
