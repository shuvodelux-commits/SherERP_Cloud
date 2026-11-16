import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {auditPurchaseStockMovementProvenance} from '../src/modules/m05-purchase-stock-movement-provenance.js';

function originalFunction(path,name){
  const source=readFileSync(new URL('../legacy/source/'+path,import.meta.url),'utf8');
  const fn=parse(source,{ecmaVersion:'latest',sourceType:'script'}).body
    .find(node=>node.type==='FunctionDeclaration'&&node.id.name===name);
  assert.ok(fn,'Frozen GAS declaration unavailable: '+name);
  return source.slice(fn.start,fn.end);
}
const source={
  create:originalFunction('Purchase.gs','createPurchase'),
  update:originalFunction('PurchaseManagement.gs','updatePurchaseInternal_'),
  remove:originalFunction('DeleteEngine.gs','deletePurchase')
};
const purchase=(id='PUR-1',deleted=false)=>({
  'Purchase ID':id,'Is Deleted':deleted?'TRUE':'FALSE'
});
const item=(productId,qty,purchaseId='PUR-1')=>({
  'Purchase ID':purchaseId,'Product ID':productId,'Quantity':qty
});
const movement=(id,type,productId,qtyIn,qtyOut,purchaseId='PUR-1',extra={})=>({
  'Movement ID':id,'Type':type,'Reference':purchaseId,
  'Product ID':productId,'Quantity In':qtyIn,'Quantity Out':qtyOut,...extra
});
const base=()=>({
  purchases:[purchase()],
  purchaseItems:[item('P-A',5),item('P-B',2)],
  stockMovements:[
    movement('M-1','Purchase','P-A',5,'','PUR-1',{'Lot ID':'LOT-A'}),
    movement('M-2','Purchase','P-B',2,'','PUR-1',{'Lot ID':'LOT-B'})
  ]
});
const audit=s=>auditPurchaseStockMovementProvenance(s);
const codes=result=>result.issues.map(x=>x.code);

test('frozen source proves Purchase, Purchase Update, Purchase Deleted signed movement contracts',()=>{
  assert.match(source.create,/'Type': 'Purchase'/);
  assert.match(source.create,/'Reference': purchaseId/);
  assert.match(source.create,/'Lot ID': lotId/);
  assert.match(source.update,/'Type': 'Purchase Update'/);
  assert.match(source.update,/'Quantity In': c.delta > 0 \? c.delta : ''/);
  assert.match(source.update,/'Quantity Out': c.delta < 0 \? Math.abs\(c.delta\) : ''/);
  assert.match(source.update,/deleteRow_\('PURCHASE_ITEMS'/);
  assert.match(source.remove,/'Purchase Deleted'/);
  assert.match(source.remove,/markRowDeleted_\('PURCHASES'/);
});

test('ordinary created purchase stock movements conserve current item quantities, without mutation',()=>{
  const snapshot=base(),before=structuredClone(snapshot);
  const result=audit(snapshot);
  assert.equal(result.ready,true);
  assert.deepEqual(result.issues,[]);
  assert.deepEqual(result.summary,{
    purchases:1,items:2,purchaseMovements:2,checkedProducts:2,issueCount:0
  });
  assert.deepEqual(snapshot,before);
});

test('purchase edit raises and lowers stock by movement deltas, not duplicate full purchase postings',()=>{
  const s=base();
  s.purchaseItems[0].Quantity=7;
  s.purchaseItems[1].Quantity=1;
  s.stockMovements.push(
    movement('MU-1','Purchase Update','P-A',2,''),
    movement('MU-2','Purchase Update','P-B','',1)
  );
  assert.equal(audit(s).ready,true);
  assert.equal(audit(s).summary.purchaseMovements,4);
  s.stockMovements.push(movement('MU-3','Purchase Update','P-A',7,''));
  assert.ok(codes(audit(s)).includes('QUANTITY_MISMATCH'),
    'full purchase repost instead of +2 must not silently pass');
});

test('new purchase product can originate in an Update movement without a Purchase movement or Lot ID',()=>{
  const s=base();
  s.purchaseItems.push(item('P-NEW',4));
  s.stockMovements.push(movement('MU-NEW','Purchase Update','P-NEW',4,'','PUR-1',{'Lot ID':''}));
  assert.equal(audit(s).ready,true);
  assert.deepEqual(audit(s).issues,[]);
});

test('removed product line remains in original movement history and must net to zero',()=>{
  const s=base();
  s.purchaseItems=s.purchaseItems.filter(x=>x['Product ID']!=='P-B');
  s.stockMovements.push(movement('MU-REMOVE','Purchase Update','P-B','',2));
  assert.equal(audit(s).ready,true);
  s.stockMovements.pop();
  const r=audit(s);
  assert.equal(r.ready,false);
  assert.ok(codes(r).includes('QUANTITY_MISMATCH'));
  assert.equal(r.issues.find(x=>x.code==='QUANTITY_MISMATCH').productId,'P-B');
});

test('soft-deleted purchase keeps item history and requires exact per-product Purchase Deleted reversal',()=>{
  const s=base();
  s.purchases[0]['Is Deleted']='TRUE';
  s.stockMovements.push(
    movement('MD-1','Purchase Deleted','P-A','',5),
    movement('MD-2','Purchase Deleted','P-B','',2)
  );
  assert.equal(audit(s).ready,true);
  s.stockMovements.pop();
  const result=audit(s);
  assert.equal(result.ready,false);
  assert.ok(codes(result).includes('MISSING_PURCHASE_DELETION'));
  assert.ok(codes(result).includes('QUANTITY_MISMATCH'));
  s.stockMovements.push(movement('MD-2','Purchase Deleted','P-B','',3));
  assert.ok(codes(audit(s)).includes('QUANTITY_MISMATCH'),
    'deleted purchase must not reverse extra physical stock');
});

test('purchase return, sale and adjustment movements have other references and never enter purchase equation',()=>{
  const s=base();
  s.stockMovements.push(
    movement('R-1','Purchase Return','P-A','',2,'PUR-RET-1'),
    movement('S-1','Sale','P-A','',1,'INV-1'),
    movement('A-1','Adjustment','P-B',2,'','OPENING')
  );
  assert.equal(audit(s).ready,true);
  assert.equal(audit(s).summary.purchaseMovements,2);
});

test('duplicate initial purchase movement and duplicate globally scoped Movement ID fail closed',()=>{
  const s=base();
  s.stockMovements.push(movement('M-3','Purchase','P-A',5,''));
  assert.ok(codes(audit(s)).includes('DUPLICATE_PURCHASE_ORIGIN'));
  s.stockMovements.pop();
  s.stockMovements.push(movement('M-1','Purchase Update','P-A',1,''));
  assert.ok(codes(audit(s)).includes('DUPLICATE_MOVEMENT_ID'));
});

test('missing creation, unknown purchase references and orphan items are migration blockers',()=>{
  const s=base();
  s.stockMovements.shift();
  assert.ok(codes(audit(s)).includes('MISSING_PURCHASE_MOVEMENT'));
  assert.ok(codes(audit(s)).includes('QUANTITY_MISMATCH'));
  s.stockMovements.push(movement('M-UNKNOWN','Purchase','P-C',3,'','PUR-FOREIGN'));
  assert.ok(codes(audit(s)).includes('ORPHAN_PURCHASE_MOVEMENT'));
  s.purchaseItems.push(item('P-ORPHAN',1,'PUR-NO-HEADER'));
  assert.ok(codes(audit(s)).includes('ORPHAN_PURCHASE_ITEM'));
});

test('impossible signs, dual-direction and nonfinite quantities block provenance',()=>{
  for(const [inQty,outQty] of [
    [0,0],[2,1],[-2,''],['Infinity',''],['bogus','']
  ]){
    const s=base();
    s.stockMovements[0]['Quantity In']=inQty;
    s.stockMovements[0]['Quantity Out']=outQty;
    assert.ok(codes(audit(s)).includes('INVALID_MOVEMENT_QUANTITY')||
      codes(audit(s)).includes('INVALID_MOVEMENT_DIRECTION'),
      'invalid Purchase movement '+String(inQty)+'/'+String(outQty));
  }
  const s=base();
  s.purchaseItems[0].Quantity=-5;
  assert.ok(codes(audit(s)).includes('INVALID_ITEM_QUANTITY'));
});

test('duplicate active purchase IDs and duplicate source Purchase Item product lines block safe import',()=>{
  const s=base();
  s.purchases.push(purchase());
  assert.ok(codes(audit(s)).includes('DUPLICATE_PURCHASE_ID'));
  s.purchases.pop();
  s.purchaseItems.push(item('P-A',1));
  assert.ok(codes(audit(s)).includes('DUPLICATE_PURCHASE_PRODUCT'));
});

test('missing source IDs, malformed snapshot rows and accessor traps are rejected',()=>{
  const s=base();
  s.stockMovements[0]['Movement ID']='';
  assert.ok(codes(audit(s)).includes('MISSING_MOVEMENT_ID'));
  const t=base();
  t.stockMovements[0]['Product ID']='';
  assert.ok(codes(audit(t)).includes('MISSING_PRODUCT_ID'));
  assert.throws(()=>audit({purchases:[],purchaseItems:null,stockMovements:[]}),/snapshot/i);
  assert.throws(()=>audit({purchases:[new Date()],purchaseItems:[],stockMovements:[]}),/row/i);
  const getter=Object.defineProperty({},'Movement ID',{get(){throw Error('malicious getter');}});
  assert.throws(()=>audit({...base(),stockMovements:[getter]}),/row|accessor/i);
});

test('module is internal only: source checks do not expose auth, SQL or live record writes',()=>{
  const runtime=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const implementation=readFileSync(new URL('../src/modules/m05-purchase-stock-movement-provenance.js',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/auditPurchaseStockMovementProvenance|m05-purchase-stock-movement-provenance/);
  assert.doesNotMatch(implementation,/SpreadsheetApp|LockService|\bfetch\s*\(|\.batch\s*\(|\.run\s*\(|\.put\s*\(/);
});
