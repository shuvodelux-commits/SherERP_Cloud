import test from 'node:test';
import assert from 'node:assert/strict';
import {originalSalesDraftList} from './fixtures/m06-draft-list-oracle.mjs';
import {projectSaleDraftList} from '../src/modules/sale-draft-list.js';

const baseRow={
  'Draft ID':'SD-1','Draft No':'DRAFT-2026-0001','Draft Date':'2026-11-10T18:45:00',
  'Customer ID':'CUS-017','Customer Name':'Selected Customer','Customer Phone':'01700000000',
  'Subtotal':180,'Discount':20,'Grand Total':160,
  'Created By ID':'U-A','Created By Name':'Seller A',
  'Updated At':'2026-11-15T10:00:00','Created At':'2026-11-10T11:00:00',
  Version:3,'Items JSON':'[{"private":"line"}]','Payment JSON':'{"private":"bank account"}',
  Notes:'Not for list display'
};
const row=(id,override={})=>({...baseRow,'Draft ID':id,'Draft No':'DRAFT-'+id,...override});
const rows=[
  row('SD-A',{'Created By ID':'U-A','Updated At':'2026-11-14T18:30:00','Draft Date':'2026-11-02'}),
  row('SD-B',{'Created By ID':'U-B','Updated At':'2026-11-15T17:30:00','Draft Date':'2026-11-03'}),
  row('SD-C',{'Created By ID':'U-A','Updated At':'2026-11-15T09:00:00','Draft Date':'2026-10-01'}),
  row('SD-D',{'Created By ID':'U-C','Updated At':'2026-11-12T08:00:00','Draft Date':'2026-11-12'})
];
const owner={actorId:'U-A',manageAll:false},manager={actorId:'U-MANAGER',manageAll:true};
const source=(items,access)=>{
  const response=originalSalesDraftList(items,{'User ID':access.actorId},
    {posAdd:!access.manageAll,salesEdit:access.manageAll});
  assert.equal(response.success,true,JSON.stringify(response));
  return response.data;
};
const verify=(items,access)=>{
  const actual=projectSaleDraftList(items,access);
  assert.deepEqual(actual,source(items,access));
  return actual;
};

test('owner sees only exact Created By ID, not same name/phone or other staff drafts',()=>{
  const result=verify(rows,owner);
  assert.deepEqual(result.map(x=>x.draftId),['SD-C','SD-A']);
  assert.ok(result.every(x=>x.mine===true && x.canManage===true));
});
test('manager with sales.edit sees every source draft and owner flags remain exact',()=>{
  const result=verify(rows,manager);
  assert.deepEqual(result.map(x=>x.draftId),['SD-B','SD-C','SD-A','SD-D']);
  assert.ok(result.every(x=>x.mine===false && x.canManage===true));
});
test('sales.edit manager who created a draft still gets mine true only on their row',()=>{
  const other=[...rows,row('SD-M',{'Created By ID':'U-MANAGER','Updated At':'2026-11-16T10:00:00'})];
  const result=verify(other,manager);
  assert.equal(result[0].mine,true);
  assert.equal(result[0].canManage,true);
  assert.ok(result.slice(1).every(x=>!x.mine));
});
test('owner cannot see draft with same Customer ID, phone or customer name saved by another staff',()=>{
  const result=verify([...rows,row('SD-OTHER',{
    'Created By ID':'U-B','Customer ID':'CUS-017','Customer Phone':'01700000000'
  })],owner);
  assert.equal(result.some(x=>x.draftId==='SD-OTHER'),false);
});
test('sort uses last Updated At descending, ignoring old backdated Draft Date',()=>{
  const result=verify(rows,manager);
  assert.deepEqual(result.map(x=>x.draftDate),['2026-11-03','2026-10-01','2026-11-02','2026-11-12']);
});
test('return includes exactly native list metadata without saved item, payment JSON or notes',()=>{
  const [result]=verify([baseRow],owner);
  const expected=[
    'canManage','createdById','createdByName','customerId','customerName','customerPhone',
    'discount','draftDate','draftId','draftNo','grandTotal','mine','subtotal','updatedAt','version'
  ];
  assert.deepEqual(Object.keys(result).sort(),expected);
  assert.equal(result.customerId,'CUS-017');
  assert.equal(result.draftDate,'2026-11-10');
  assert.equal(result.version,3);
});
test('legacy blank money and version fields default to source numeric values',()=>{
  const [result]=verify([row('SD-EMPTY',{
    'Subtotal':'','Discount':null,'Grand Total':undefined,Version:'', 'Draft Date':''
  })],owner);
  assert.deepEqual([result.subtotal,result.discount,result.grandTotal,result.version],[0,0,0,1]);
  assert.equal(result.draftDate,'');
});
test('version string is emitted as number, with original source fallback for zero',()=>{
  const [result]=verify([row('SD-VER',{Version:'7','Subtotal':'120.50'})],owner);
  assert.equal(result.version,7);
  assert.equal(result.subtotal,120.5);
  const [zero]=verify([row('SD-ZERO',{Version:0})],owner);
  assert.equal(zero.version,1);
});
test('no matching owner produces empty list; authorized manager with no rows also empty',()=>{
  assert.deepEqual(verify(rows,{actorId:'U-OTHER',manageAll:false}),[]);
  assert.deepEqual(verify([],manager),[]);
});
test('pure draft list projection never reorders or mutates original rows',()=>{
  const input=structuredClone(rows),before=JSON.stringify(input);
  verify(input,manager);
  verify(input,owner);
  assert.equal(JSON.stringify(input),before);
});
test('native source requires pos.add or sales.edit before listing any drafts',()=>{
  const noRights=originalSalesDraftList(rows,{'User ID':'U-A'},{posAdd:false,salesEdit:false});
  assert.equal(noRights.success,false);
  assert.match(noRights.message,/permission to access draft invoices/);
});
test('trusted actor identity and explicit sales.edit-derived boolean are mandatory',()=>{
  assert.throws(()=>projectSaleDraftList(rows),/trusted/i);
  assert.throws(()=>projectSaleDraftList(rows,{actorId:'U-A'}),/trusted/i);
  assert.throws(()=>projectSaleDraftList(rows,{actorId:'',manageAll:false}),/trusted/i);
  assert.throws(()=>projectSaleDraftList(rows,{actorId:'U-A',manageAll:'yes'}),/trusted/i);
  assert.throws(()=>projectSaleDraftList(null,owner),/trusted/i);
});


test('tenant duplicate Draft ID across different staff owners fails closed before staff-only filtering',()=>{
  const duplicate=[
    row('SD-COLLISION',{'Created By ID':'U-A','Updated At':'2026-11-15T11:00:00'}),
    row('SD-COLLISION',{'Created By ID':'U-B','Updated At':'2026-11-15T12:00:00'})
  ];
  for(const access of [owner,manager]){
    assert.throws(()=>projectSaleDraftList(duplicate,access),
      /NEEDS_REVIEW: duplicate Sales Draft ID in tenant snapshot/,
      access.manageAll?'manager':'owner');
  }
});

test('same Draft No or Customer across two different draft IDs retains source list parity',()=>{
  const different=[
    row('SD-SOURCE-1',{'Draft No':'DRAFT-AMBIGUOUS','Created By ID':'U-A'}),
    row('SD-SOURCE-2',{'Draft No':'DRAFT-AMBIGUOUS','Created By ID':'U-B'})
  ];
  assert.deepEqual(verify(different,manager).map(x=>x.draftId),
    ['SD-SOURCE-1','SD-SOURCE-2']);
  assert.deepEqual(verify(different,owner).map(x=>x.draftId),['SD-SOURCE-1']);
});
