import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeDeleteDraft} from './fixtures/m06-draft-delete-oracle.mjs';
import {planSaleDraftDeletion} from '../src/modules/sale-draft-delete-plan.js';

const time='2026-11-15T13:25:00.000Z';
const cashier={
  actorId:'STAFF-1',actorName:'Cashier One',
  canAddPos:true,canViewPos:true,canEditSales:false,deletedAt:time
};
const manager={
  actorId:'MANAGER-3',actorName:'Manager Three',
  canAddPos:false,canViewPos:false,canEditSales:true,deletedAt:time
};
const row=(x={})=>({
  'Draft ID':'DRAFT-ID-1','Draft No':'DS-2026-001','Version':4,
  'Created By ID':'STAFF-1','Created By Name':'Cashier One',
  'Customer ID':'C-123','Customer Name':'Shared Name',
  'Customer Phone':'01700000001',...x
});
const copy=x=>JSON.parse(JSON.stringify(x));
function parity(id='DRAFT-ID-1',expectedVersion=4,reason='duplicate entry',rows=[row()],trusted=cashier){
  const native=nativeDeleteDraft(id,expectedVersion,reason,rows,trusted);
  let actual;
  try{
    const result=planSaleDraftDeletion(id,expectedVersion,reason,rows,trusted);
    actual={success:true,...result,events:['audit','delete']};
  }catch(error){
    actual={success:false,message:error.message,audit:null,guard:null,events:[]};
  }
  assert.deepEqual(copy(actual),native);
  return actual;
}

test('source owner with POS add can plan deletion and receive exact native reply',()=>{
  const result=parity();
  assert.equal(result.reply.draftId,'DRAFT-ID-1');
});
test('sales.edit manager can delete another owner draft WITHOUT pos.view',()=>{
  const result=parity('DRAFT-ID-1',4,'', [row()],manager);
  assert.equal(result.success,true);
});
test('owner also succeeds with pos.view=false when pos.add remains true',()=>{
  const result=parity('DRAFT-ID-1',4,'', [row()],{...cashier,canViewPos:false});
  assert.equal(result.success,true);
});
test('source does not allow POS-view-only staff to manage draft',()=>{
  const result=parity('DRAFT-ID-1',4,'', [row()],{
    ...cashier,canAddPos:false,canEditSales:false
  });
  assert.match(result.message,/permission to access draft invoices/);
});
test('other cashier may not delete draft even with matching Customer ID and phone',()=>{
  const result=parity('DRAFT-ID-1',4,'', [row()],{...cashier,actorId:'STAFF-2'});
  assert.match(result.message,/permission to manage this draft/);
});
test('source checks feature/owner access before version conflict',()=>{
  const result=parity('DRAFT-ID-1',3,'', [row()],{...cashier,actorId:'STAFF-2'});
  assert.match(result.message,/permission to manage this draft/);
});
test('same numeric Version string as row is accepted',()=>{
  const result=parity(' DRAFT-ID-1 ', '4', ' ',[row()],cashier);
  assert.equal(result.reply.draftId,'DRAFT-ID-1');
});
test('stale and invalid expected versions reject, plan has no audit or delete',()=>{
  for(const version of [3,5,null,'wrong']){
    const result=parity('DRAFT-ID-1',version,'text',[row()],cashier);
    assert.equal(result.success,false);
    assert.match(result.message,/draft was changed by another user/);
    assert.equal(result.audit,null);
    assert.equal(result.guard,null);
  }
});
test('missing draft rejects rather than matching draftNo or Customer ID',()=>{
  for(const id of ['',null,'DS-2026-001','C-123']){
    const result=parity(id,4,'text',[row()],cashier);
    assert.match(result.message,/Draft not found/);
  }
});
test('audit action is DELETED and preserves SOURCE Version, not Version+1',()=>{
  const result=parity();
  assert.equal(result.audit.action,'DELETED');
  assert.equal(result.audit.version,4);
});
test('DELETED audit records exact actor, owner and immutable draft identity',()=>{
  const result=parity('DRAFT-ID-1',4,'',[row()],manager);
  assert.deepEqual(result.audit,{
    action:'DELETED',draftId:'DRAFT-ID-1',draftNo:'DS-2026-001',
    version:4,actorId:'MANAGER-3',actorName:'Manager Three',
    sourceOwnerId:'STAFF-1',invoiceId:'',note:'',timestamp:time
  });
});
test('reason is trimmed to exact audit Note without creating a ledger entry',()=>{
  const result=parity('DRAFT-ID-1',4,'   duplicate selection   ');
  assert.equal(result.audit.note,'duplicate selection');
});
test('empty, null and numeric zero deletion reasons normalize to blank source Note',()=>{
  for(const why of ['',null,0]){
    const result=parity('DRAFT-ID-1',4,why);
    assert.equal(result.audit.note,'');
  }
});
test('audit-before-delete ordering is preserved in source and future transaction intent',()=>{
  const result=parity();
  assert.deepEqual(result.events,['audit','delete']);
  assert.equal(result.guard.draftId,'DRAFT-ID-1');
});
test('missing saved Version retains native numeric coercion and audit fallback',()=>{
  const result=parity('DRAFT-ID-1',0,'',[row({'Version':''})],cashier);
  assert.equal(result.success,true);
  assert.equal(result.audit.version,1);
});
test('draft and trusted actor snapshots remain immutable after planning',()=>{
  const rows=[row()],trusted=structuredClone(manager),before=copy({rows,trusted});
  parity('DRAFT-ID-1',4,'a reason',rows,trusted);
  assert.deepEqual(copy({rows,trusted}),before);
});
test('duplicate draft IDs fail closed rather than deleting arbitrary owner row',()=>{
  const rows=[row(),row({'Created By ID':'OTHER','Version':5})];
  assert.throws(()=>planSaleDraftDeletion('DRAFT-ID-1',4,'',rows,cashier),/Duplicate draft ID/);
});
test('trusted identity, boolean permission and UTC timestamp required',()=>{
  for(const bad of [
    {...cashier,actorId:''},
    {...cashier,actorName:''},
    {...cashier,canEditSales:'true'},
    {...cashier,deletedAt:'2026-11-15'},
    {...cashier,deletedAt:'not-a-date'}
  ]){
    assert.throws(()=>planSaleDraftDeletion('DRAFT-ID-1',4,'',[row()],bad),/trusted/i);
  }
  assert.throws(()=>planSaleDraftDeletion('DRAFT-ID-1',4,'',undefined,cashier),/trusted/i);
});
test('unauthorized staff cannot bypass draft owner using customer identity or relation',()=>{
  const draft=row({'Customer ID':'STAFF-2','Created By ID':'STAFF-1'});
  const result=parity('DRAFT-ID-1',4,'',[draft],{...cashier,actorId:'STAFF-2'});
  assert.match(result.message,/permission to manage this draft/);
});
