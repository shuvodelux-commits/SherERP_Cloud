import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {planPurchaseReturnLots} from '../src/modules/purchase-return-lot-plan.js';

// Frozen source is the authoritative oracle, not an in-memory restatement of its algorithm.
const frozen=readFileSync(new URL('../legacy/source/StockLots.gs',import.meta.url));
const sourceSha=createHash('sha1').update('blob '+frozen.length+'\0').update(frozen).digest('hex');
assert.equal(sourceSha,'90b2be03c8d6d08ebb4e444b6350011c02deaaf4');
const text=frozen.toString('utf8');
function originalFunction(name){
  const at=text.indexOf('function '+name+'(');
  assert.ok(at>=0,'Missing frozen source function '+name);
  const end=text.indexOf('\n}',at);
  assert.ok(end>at,'Incomplete frozen source function '+name);
  return text.slice(at,end+2);
}
function nativePlan({purchaseId,productId,qty,lots,product=null}){
  const rows=structuredClone(lots);
  const ctx=vm.createContext({
    __purchaseId:purchaseId,__productId:productId,__qty:qty,__lots:rows,
    safeDateOnly_:value=>value?String(value).slice(0,10):'',
    isValidNonNegativeNumber_:value=>Number.isFinite(Number(value))&&Number(value)>=0,
    getAllRows_:group=>group==='PRODUCTS'?(product?[structuredClone(product)]:[]):rows
  });
  for(const name of ['compareLotsFifo_','lotSellPrice_','planStockConsumption_',
    'planPurchaseReturnLotReduction_'])
    vm.runInContext(originalFunction(name),ctx,{timeout:1000});
  const result=vm.runInContext(
    'planPurchaseReturnLotReduction_(__purchaseId,__productId,__qty,__lots)',ctx,{timeout:1000});
  return structuredClone(result);
}
const lot=(id,purchaseId,date,remaining,index,extra={})=>({
  'Lot ID':id,'Purchase ID':purchaseId,'Product ID':'PIPE',
  'Purchase Date':date,'Created At':date+'T09:00:00',
  'Remaining Quantity':remaining,'Purchase Price':12.5,'Sell Price':18,
  _rowIndex:index,...extra
});
const product={'Product ID':'PIPE','Selling Price':19,'Purchase Price':12.5};
function compare(input){
  const before=structuredClone(input.lots);
  const expected=nativePlan(input);
  const result=planPurchaseReturnLots(input);
  assert.deepEqual(result,expected);
  assert.deepEqual(input.lots,before,'preflight must not mutate source rows');
  return result;
}

test('multiple original purchase lots reduce FIFO by date then Lot ID, never consume older unrelated purchase',()=>{
  const lots=[
    lot('L-2','P-1','2026-11-10',2,7),
    lot('OUTSIDE','P-2','2020-01-01',99,8),
    lot('L-1','P-1','2026-11-10',1,9),
    lot('L-3','P-1','2026-11-11',3,10)
  ];
  const result=compare({purchaseId:'P-1',productId:'PIPE',qty:4,lots,product});
  assert.equal(result.legacyFallback,false);
  assert.equal(result.draws.length,3);
  assert.equal(result.draws.reduce((sum,row)=>sum+row.take,0),4);
  assert.ok(result.draws.every(row=>row.lotId!=='OUTSIDE'));
});

test('exhausted original purchase lots decline even when other purchases have stock',()=>{
  const input={purchaseId:'P-1',productId:'PIPE',qty:2,
    lots:[lot('SPENT','P-1','2026-11-01',0,1),lot('OTHER','P-2','2026-01-01',20,2)],product};
  assert.throws(()=>nativePlan(input),/Lots for this purchase only have 0 remaining/);
  assert.throws(()=>planPurchaseReturnLots(input),/Lots for this purchase only have 0 remaining/);
});

test('native legacy fallback uses other available product lots, with an explicit review flag',()=>{
  const result=compare({purchaseId:'LEGACY-PUR',productId:'PIPE',qty:3,product,
    lots:[lot('A','NEW-1','2026-11-09',2,1,{ 'Sell Price':'' }),
      lot('B','NEW-2','2026-11-10',2,2),lot('DIFFERENT','NEW-2','2026-01-01',99,3,
        {'Product ID':'WIRE'})]});
  assert.equal(result.legacyFallback,true);
  assert.equal(result.draws.length,2);
  assert.equal(result.draws[0].unitSellPrice,19);
});

test('legacy stock shortage declines before any lot can be written',()=>{
  const input={purchaseId:'LEGACY',productId:'PIPE',qty:3,product,
    lots:[lot('A','SOMETHING','2026-11-10',2,1)]};
  assert.throws(()=>nativePlan(input),/Only 2 units are available in stock lots/);
  assert.throws(()=>planPurchaseReturnLots(input),/Only 2 units are available in stock lots/);
});

test('fractional multi-unit quantities and zero requests match native source',()=>{
  const lots=[lot('A','P-1','2026-11-10',1.25,1),lot('B','P-1','2026-11-11',1.5,2)];
  assert.equal(compare({purchaseId:'P-1',productId:'PIPE',qty:2,lots,product}).draws.length,2);
  assert.equal(compare({purchaseId:'P-1',productId:'PIPE',qty:0,lots,product}).draws.length,0);
});

test('reject ambiguous duplicate Lot IDs and unsafe or malformed input',()=>{
  const valid={purchaseId:'P-1',productId:'PIPE',qty:1,lots:[lot('L-1','P-1','2026-11-10',2,1)],product};
  assert.throws(()=>planPurchaseReturnLots({...valid,lots:[lot('L-1','P-1','2026-11-10',2,1),
    lot('L-1','P-1','2026-11-11',2,2)]}),/Duplicate Lot ID/);
  assert.throws(()=>planPurchaseReturnLots({...valid,qty:Infinity}),/Invalid/);
  assert.throws(()=>planPurchaseReturnLots({...valid,lots:[{'Lot ID':'L',get ['Remaining Quantity'](){throw Error('getter');}}]}),/Invalid/);
  assert.throws(()=>planPurchaseReturnLots({...valid,lots:Promise.resolve([])}),/Invalid/);
});


test('refuse unnormalized or calendar-invalid lot dates before FIFO selection',()=>{
  const sample={purchaseId:'P-1',productId:'PIPE',qty:1,product,
    lots:[lot('L-1','P-1','2026-11-10',2,1)]};
  assert.throws(()=>planPurchaseReturnLots({...sample,lots:[
    {...sample.lots[0],'Purchase Date':new Date('2026-11-10T00:00:00Z')}]})
    ,/Invalid/);
  assert.throws(()=>planPurchaseReturnLots({...sample,lots:[
    {...sample.lots[0],'Purchase Date':'10/11/2026'}]})
    ,/Invalid/);
  assert.throws(()=>planPurchaseReturnLots({...sample,lots:[
    {...sample.lots[0],'Purchase Date':'2026-02-30'}]})
    ,/Invalid/);
  assert.throws(()=>planPurchaseReturnLots({...sample,lots:[
    {...sample.lots[0],'Created At':new Date('2026-11-10T10:00:00Z')}]})
    ,/Invalid/);
});
