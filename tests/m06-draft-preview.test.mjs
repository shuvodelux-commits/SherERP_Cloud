import test from 'node:test';
import assert from 'node:assert/strict';
import {createM06NativeDraftOracle} from './fixtures/m06-draft-preview-oracle.mjs';
import {parseSaleDraftRow,projectSaleDraftInvoice} from '../src/modules/sale-draft-preview.js';

const paymentAccounts=[
  {'Bank Account ID':'B-1','Account Name':'Shop Bank','Account Type':'Bank',Status:'Active','Is Deleted':'FALSE'},
  {'Bank Account ID':'M-1','Account Name':'Mobile Wallet','Account Type':'Mobile Banking',Status:'Active','Is Deleted':'FALSE'},
  {'Bank Account ID':'B-INACTIVE','Account Name':'Old Bank','Account Type':'Bank',Status:'Inactive','Is Deleted':'FALSE'},
  {'Bank Account ID':'B-DELETED','Account Name':'Deleted Bank','Account Type':'Bank',Status:'Active','Is Deleted':'TRUE'}
];
const shop={name:'Shop Identity',currencySymbol:'৳',footer:'Original invoice footer'};
const line={productId:'P-1',name:'Copper Wire',qty:2,unitPrice:120,lineTotal:240,productType:'Standard'};
const baseRow={
  'Draft ID':'SD-1','Draft No':'DRAFT-2026-0042','Draft Date':'2026-11-15T10:45:31',
  'Customer ID':'CUSTOMER-007','Customer Name':'Original Selection','Customer Phone':'01700000000',
  'Customer Father Name':'Person Name','Customer Relation Type':'Husband',
  'Customer Address':'Dhaka','Items JSON':JSON.stringify([line]),
  'Payment JSON':JSON.stringify({payments:[
    {id:'BANK',method:'Bank',amount:'150.00',accountId:'B-1'},
    {id:'CASH',method:'Cash',amount:'100.00'}
  ]}),
  'Notes':'Keep exact customer','Subtotal':240,'Discount':0,'Grand Total':240,
  'Created By ID':'USER-1','Created By Name':'Sales Clerk','Created At':'2026-11-15T10:45:31',
  'Updated By ID':'USER-1','Updated By Name':'Sales Clerk','Updated At':'2026-11-15T10:45:31',
  Version:3
};
const native=()=>createM06NativeDraftOracle({paymentAccounts,shop});
const sourceOutcome=(row)=>{
  try{return {ok:true,value:native().preview(row)}}catch(e){return {ok:false,error:e.message}}
};
const portOutcome=(row)=>{
  try{return {ok:true,value:projectSaleDraftInvoice(row,{paymentAccounts,shop})}}catch(e){return {ok:false,error:e.message}}
};
const plain=x=>JSON.parse(JSON.stringify(x));

test('draft parser preserves selected Customer ID, saved relation, version and actor snapshots',()=>{
  assert.deepEqual(plain(parseSaleDraftRow(baseRow)),native().parse(baseRow));
  assert.equal(parseSaleDraftRow(baseRow).customerId,'CUSTOMER-007');
  assert.equal(parseSaleDraftRow(baseRow).customerRelationType,'Husband');
  assert.equal(parseSaleDraftRow(baseRow).version,3);
  assert.equal(parseSaleDraftRow(baseRow).draftDate,'2026-11-15');
});

test('split draft preview matches native invoice shape, including cash change and original tender',()=>{
  const out=projectSaleDraftInvoice(baseRow,{paymentAccounts,shop});
  assert.deepEqual(plain(out),native().preview(baseRow));
  assert.equal(out.isDraft,true);
  assert.equal(out.invoiceId,'DRAFT-2026-0042');
  assert.equal(out.paymentType,'Draft');
  assert.equal(out.paymentStatus,'Draft');
  assert.equal(out.paymentDetailVersion,'1');
  assert.equal(out.customerId,'CUSTOMER-007');
  assert.deepEqual(out.payments.map(p=>[p.method,p.tendered,p.applied,p.change]),[
    ['Bank',150,150,0],['Cash',100,90,10]
  ]);
  assert.deepEqual([out.paidAmount,out.originalPaidAmount,out.dueAmount],[240,240,0]);
});

test('partial Bank/Mobile split retains actual accounts and leaves an independent due balance',()=>{
  const row={...baseRow,'Grand Total':400,'Payment JSON':JSON.stringify({payments:[
    {id:'B',method:'Bank',amount:'100',accountId:'B-1'},
    {id:'M',method:'Mobile Banking',amount:'125',accountId:'M-1'}
  ]})};
  assert.deepEqual(portOutcome(row),sourceOutcome(row));
  const out=projectSaleDraftInvoice(row,{paymentAccounts,shop});
  assert.deepEqual([out.paidAmount,out.dueAmount,out.paymentMethod,out.paymentStatus],[225,175,'Multiple','Draft']);
  assert.deepEqual(out.payments.map(p=>p.bankAccountId),['B-1','M-1']);
});

test('legacy draft form stays legacy: no synthesized payment children or version',()=>{
  const row={...baseRow,'Payment JSON':JSON.stringify({amountReceived:'120',paymentMethod:'Cash',bankAccountId:''})};
  assert.deepEqual(portOutcome(row),sourceOutcome(row));
  const out=projectSaleDraftInvoice(row,{paymentAccounts,shop});
  assert.deepEqual([out.paymentDetailVersion,out.paymentMethod,out.payments.length,out.paidAmount,out.dueAmount],['','Cash',0,120,120]);
});

test('legacy over-tender and nonsensical amount received match original clamping',()=>{
  for(const value of ['-5','1000','NaN','']){
    const row={...baseRow,'Payment JSON':JSON.stringify({amountReceived:value,paymentMethod:'Cash'})};
    assert.deepEqual(portOutcome(row),sourceOutcome(row));
  }
});

test('bad saved JSON falls back to original empty items and legacy payment object',()=>{
  const row={...baseRow,'Items JSON':'not-json','Payment JSON':'{broken'};
  assert.deepEqual(plain(parseSaleDraftRow(row)),native().parse(row));
  assert.deepEqual(portOutcome(row),sourceOutcome(row));
  assert.deepEqual(projectSaleDraftInvoice(row,{paymentAccounts,shop}).items,[]);
});

test('split account validation refuses inactive, deleted, wrong-type or overpaid tenders',()=>{
  const invalid=[
    [{id:'a',method:'Bank',amount:1,accountId:'B-INACTIVE'}],
    [{id:'a',method:'Bank',amount:1,accountId:'B-DELETED'}],
    [{id:'a',method:'Mobile Banking',amount:1,accountId:'B-1'}],
    [{id:'a',method:'Bank',amount:250,accountId:'B-1'}],
    [{id:'a',method:'Cash',amount:'0.001'}],
    [{id:'a',method:'Cash',amount:1},{id:'a',method:'Cash',amount:1}]
  ];
  for(const payments of invalid){
    const row={...baseRow,'Payment JSON':JSON.stringify({payments})};
    const source=sourceOutcome(row);
    assert.equal(source.ok,false);
    assert.deepEqual(portOutcome(row),source);
  }
});

test('preview keeps draft-status and source identity on zero-value unpaid split',()=>{
  const row={...baseRow,'Grand Total':0,'Payment JSON':JSON.stringify({payments:[]})};
  assert.deepEqual(portOutcome(row),sourceOutcome(row));
  const out=projectSaleDraftInvoice(row,{paymentAccounts,shop});
  assert.deepEqual([out.paidAmount,out.dueAmount,out.paymentDetailVersion,out.paymentStatus],[0,0,'1','Draft']);
});

test('preview never mutates persisted draft, trusted payment accounts, shop snapshot or line items',()=>{
  const row=structuredClone(baseRow),banks=structuredClone(paymentAccounts),s=structuredClone(shop);
  const before=[JSON.stringify(row),JSON.stringify(banks),JSON.stringify(s)];
  projectSaleDraftInvoice(row,{paymentAccounts:banks,shop:s});
  assert.deepEqual([JSON.stringify(row),JSON.stringify(banks),JSON.stringify(s)],before);
});

test('projection rejects missing trusted read context rather than silently using client-side account data',()=>{
  assert.throws(()=>projectSaleDraftInvoice(baseRow,{paymentAccounts:null,shop}),/payment accounts/i);
  assert.throws(()=>projectSaleDraftInvoice(baseRow,{paymentAccounts,shop:null}),/shop payload/i);
});
