import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {planPurchaseInventoryEdit,planPurchaseInventoryDelete}
  from '../src/modules/purchase-correction-guards.js';

const management=readFileSync(new URL('../legacy/source/PurchaseManagement.gs',import.meta.url),'utf8');
const deletion=readFileSync(new URL('../legacy/source/DeleteEngine.gs',import.meta.url),'utf8');
const sourceGuardStrings=[
  ['This purchase has Purchase Return records and can no longer be updated.',management],
  ['This historical purchase contains the same product on multiple lines.',management],
  ['Purchase price cannot be changed after stock from this lot has already been sold.',management],
  ['this purchase has no stock lot on file, so its quantity cannot be reduced.',management],
  ['only ',management],
  ['reducing this line would take stock to ',management],
  ['This purchase has a Purchase Return against it.',deletion],
  ['Cannot delete this purchase - stock from it has already been sold:',deletion],
  ['Cannot delete this purchase - stock would go negative:',deletion]
];
test('guard error contracts come from the pinned, unchanged native PurchaseManagement/DeleteEngine modules',()=>{
  for(const [message,source] of sourceGuardStrings)
    assert.ok(source.includes(message),'frozen source guard missing: '+message);
});
const fixture=()=>({
  purchases:[{'Purchase ID':'PUR-001','Supplier ID':'SUP-1','Date':'2026-11-10','Is Deleted':'FALSE'}],
  items:[
    {'Purchase ID':'PUR-001','Product ID':'P-1','Product Name':'Pipe','Quantity':5,'Unit Price':10},
    {'Purchase ID':'PUR-001','Product ID':'P-2','Product Name':'Switch','Quantity':3,'Unit Price':7}
  ],
  lots:[
    {'Purchase ID':'PUR-001','Lot ID':'LOT-PIPE','Product ID':'P-1','Original Quantity':5,'Remaining Quantity':3},
    {'Purchase ID':'PUR-001','Lot ID':'LOT-SWITCH','Product ID':'P-2','Original Quantity':3,'Remaining Quantity':3}
  ],
  products:[
    {'Product ID':'P-1','Product Name':'Pipe','Current Stock':8,'Is Deleted':'FALSE'},
    {'Product ID':'P-2','Product Name':'Switch','Current Stock':4,'Is Deleted':'FALSE'}
  ],
  returns:[]
});
const edited=(p1qty=4,p2qty=4,p1cost=10,p2cost=7)=>[
  {productId:'P-1',name:'Pipe',qty:p1qty,unitPrice:p1cost},
  {productId:'P-2',name:'Switch',qty:p2qty,unitPrice:p2cost}
];
const edit=(rows,lines=edited())=>planPurchaseInventoryEdit('PUR-001',rows,lines);
const deletionPlan=rows=>planPurchaseInventoryDelete('PUR-001',rows);
const message=(fn,error)=>assert.throws(fn,typeof error==='string'?{message:error}:error);

test('edits preserve exact source per-product delta, stock and cost-change decisions',()=>{
  const rows=fixture();const before=structuredClone(rows);
  assert.deepEqual(edit(rows),{
    stockChanges:[
      {productId:'P-1',delta:-1,newStock:7},
      {productId:'P-2',delta:1,newStock:5}
    ],
    costChanges:[]
  });
  assert.deepEqual(rows,before);
  assert.deepEqual(edit(rows,edited(5,3,10,8)),{
    stockChanges:[],costChanges:[{productId:'P-2',newPrice:8}]
  });
});

test('inventory edit permits reducing only still-unsold units of its own lot',()=>{
  const rows=fixture();
  assert.deepEqual(edit(rows,edited(2,3)),{
    stockChanges:[{productId:'P-1',delta:-3,newStock:5}],costChanges:[]
  });
  message(()=>edit(rows,edited(1,3)),
    'Pipe: only 3 of the 5 bought on this purchase is still unsold, so the quantity cannot be reduced by 4.');
});

test('sold lot purchase cost is immutable; unaffected and unsold purchase lots may change',()=>{
  const rows=fixture();
  message(()=>edit(rows,edited(5,3,12,7)),
    'Purchase price cannot be changed after stock from this lot has already been sold. Use a cost adjustment/correction instead.');
  assert.deepEqual(edit(rows,edited(5,3,10,9)),{
    stockChanges:[],costChanges:[{productId:'P-2',newPrice:9}]
  });
  rows.lots=rows.lots.filter(l=>l['Product ID']!=='P-2');
  message(()=>edit(rows,edited(5,3,10,9)),
    'This purchase has no stock lot on file, so its unit price cannot be changed safely.');
});

test('missing lot, aggregate negative stock and missing product block reductions',()=>{
  const rows=fixture();
  rows.lots=rows.lots.filter(l=>l['Product ID']!=='P-1');
  message(()=>edit(rows,edited(4,3)),
    'Pipe: this purchase has no stock lot on file, so its quantity cannot be reduced. Use Purchase Return instead.');
  rows.lots=fixture().lots;rows.products[0]['Current Stock']=0;
  message(()=>edit(rows,edited(4,3)),
    'Pipe: reducing this line would take stock to -1. Some of it has already been sold.');
  rows.products=[];
  message(()=>edit(rows,edited(4,3)),
    'A product on this purchase no longer exists.');
});

test('source OVERSOLD tolerance: buying MORE is valid even when current stock remains negative',()=>{
  const rows=fixture();rows.products[0]['Current Stock']=-5;
  assert.deepEqual(edit(rows,edited(6,3)).stockChanges,
    [{productId:'P-1',delta:1,newStock:-4}]);
});

test('purchase returns, deleted records, historical duplicate lines and ambiguous IDs fail closed',()=>{
  const rows=fixture();
  rows.returns=[{'Purchase ID':'PUR-001','Is Deleted':'FALSE'}];
  message(()=>edit(rows),
    'This purchase has Purchase Return records and can no longer be updated. Use Purchase Return for further corrections.');
  message(()=>deletionPlan(rows),
    'This purchase has a Purchase Return against it. Delete the return first, then delete the purchase.');
  rows.returns[0]['Is Deleted']='TRUE';
  rows.items.push({...rows.items[0]});
  message(()=>edit(rows),
    'This historical purchase contains the same product on multiple lines. It cannot be edited safely because those lines created separate stock lots. Use Purchase Return/correction instead.');
  rows.items.pop();
  rows.purchases.push({...rows.purchases[0]});
  message(()=>edit(rows),/Duplicate purchase ID detected/);
  message(()=>deletionPlan(rows),/Duplicate purchase ID detected/);
  rows.purchases.pop();
  rows.purchases[0]['Is Deleted']='TRUE';
  message(()=>edit(rows),'This purchase has been deleted.');
  message(()=>deletionPlan(rows),'This purchase is already deleted.');
});

test('source delete blocks any sold lots even when other suppliers or products have abundant stock',()=>{
  const rows=fixture();
  const before=structuredClone(rows);
  message(()=>deletionPlan(rows),
    'Cannot delete this purchase - stock from it has already been sold: Pipe (2 of 5 already sold). Delete or return the sales that used this stock first, then delete the purchase.');
  assert.deepEqual(rows,before);
});

test('delete blocks product-shortage, no lines, and missing original purchase',()=>{
  const rows=fixture();
  rows.lots[0]['Remaining Quantity']=5;
  rows.products[0]['Current Stock']=4;
  message(()=>deletionPlan(rows),
    'Cannot delete this purchase - stock would go negative: Pipe (need 5, have 4).');
  rows.products[0]['Current Stock']=10;
  assert.deepEqual(deletionPlan(rows),{
    stockReversals:[
      {productId:'P-1',qty:5,newStock:5,lotIds:['LOT-PIPE']},
      {productId:'P-2',qty:3,newStock:1,lotIds:['LOT-SWITCH']}
    ]
  });
  rows.items=[];
  message(()=>deletionPlan(rows),'This purchase has no item lines to reverse.');
  message(()=>planPurchaseInventoryDelete('DOES-NOT-EXIST',rows),'Purchase not found.');
});

test('historical duplicate lots and invalid remaining quantity are not silently guessed',()=>{
  const rows=fixture();
  rows.lots.push({...rows.lots[0],'Lot ID':'LOT-PIPE-DUP'});
  message(()=>edit(rows),/Ambiguous purchase stock lots/);
  rows.lots.pop();
  rows.lots[0]['Remaining Quantity']=-1;
  message(()=>edit(rows),/Invalid purchase lot quantity/);
});
