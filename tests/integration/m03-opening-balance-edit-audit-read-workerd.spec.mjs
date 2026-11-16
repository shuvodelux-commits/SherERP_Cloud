import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {importSourceOpeningBalanceEditAuditWithD1}
  from '../../src/db/opening-balance-edit-audit-import.js';
import {createOpeningBalanceEditAuditReadAdapter}
  from '../../src/db/opening-balance-edit-audit-read.js';
import publicWorker from '../../src/index.js';

const harness=createTestHarness({workers:[{
  configPath:'./wrangler.m02-opening-balance-edit-audit-test.jsonc'
}]});
const worker=harness.getWorker('shererp-m02-opening-balance-edit-audit-local-only');
const original=()=>[
  {'Audit ID':'OBL-1','Changed At':'2026-11-16T12:00Z','Entity Type':'CUSTOMER',
   'Entity ID':'C-1','Entity Name':'করিম','Old Opening Balance':'-150.00',
   'New Opening Balance':-100.5,Delta:49.5,'Current Due Before':'-90.00',
   'Current Due After':-40.5,Reason:' সংশোধন ','Changed By':'শুভ',_rowIndex:2},
  {'Audit ID':'OBL-2','Changed At':'2026-11-16T12:05Z','Entity Type':'CUSTOMER',
   'Entity ID':'C-1','Entity Name':'করিম','Old Opening Balance':0,
   'New Opening Balance':'-0.00',Delta:'-0.00','Current Due Before':'',
   'Current Due After':'-0.00',Reason:' আবার সংশোধন ','Changed By':'শুভ',_rowIndex:3}
];
const projected=()=>original().map((row,i)=>({
  ...row,
  ...(i===0 ? {
    'New Opening Balance':'-100.5',
    Delta:'49.5',
    'Current Due After':'-40.5'
  } : {'Old Opening Balance':'0'})
}));
let DB;
const adapter=()=>createOpeningBalanceEditAuditReadAdapter({DB});
const archiveSQL='SELECT legacy_sheet_row,audit_id,changed_at_text,entity_type,entity_id,entity_name,old_opening_balance_text,new_opening_balance_text,delta_text,current_due_before_text,current_due_after_text,reason,changed_by FROM legacy_opening_balance_edit_audit ORDER BY legacy_sheet_row';
const count=async()=>(await DB.prepare('SELECT COUNT(*) AS n FROM legacy_opening_balance_edit_audit').first()).n;

before(async()=>{
  await harness.listen();
  await worker.applyD1Migrations('DB');
  ({DB}=await worker.getEnv());
  assert.deepEqual(await importSourceOpeningBalanceEditAuditWithD1({
    DB,sourceRows:original()
  }),{sourceGroup:'OPENING_BALANCE_EDIT_LOG',importedRows:2,reconciled:true});
});
after(async()=>harness.close());

test('real local Workerd/D1 original audit import → M03 reader preserves source headers, amounts, sign and physical row',async()=>{
  const a=adapter();
  assert.deepEqual(await a.getSheetHeaders_('OPENING_BALANCE_EDIT_LOG'),[
    'Audit ID','Changed At','Entity Type','Entity ID','Entity Name',
    'Old Opening Balance','New Opening Balance','Delta',
    'Current Due Before','Current Due After','Reason','Changed By'
  ]);
  const rows=await a.getAllRows_('OPENING_BALANCE_EDIT_LOG');
  assert.deepEqual(rows,projected());
  assert.equal(rows[0]['Old Opening Balance'],'-150.00');
  assert.equal(rows[0]['New Opening Balance'],'-100.5');
  assert.equal(rows[1]['Old Opening Balance'],'0');
  assert.equal(rows[1]['New Opening Balance'],'-0.00');
  assert.equal(rows[1]['Current Due After'],'-0.00');
  assert.equal(rows[0].Reason,' সংশোধন ');
  assert.equal(rows[1]['Entity Name'],'করিম');
  assert.deepEqual(rows.map(row=>row._rowIndex),[2,3]);
  assert(rows.every(row=>!Object.hasOwn(row,'row_id')));
  assert.equal(await count(),2);
});

test('real D1 lookups retain repeated edits to one entity and preserve unique Audit ID first-match source row',async()=>{
  const a=adapter();
  assert.deepEqual(await a.findRows_('OPENING_BALANCE_EDIT_LOG','Entity ID','C-1'),projected());
  assert.deepEqual(await a.findFirstRow_('OPENING_BALANCE_EDIT_LOG','Entity ID','C-1'),projected()[0]);
  assert.deepEqual(await a.findRow_('OPENING_BALANCE_EDIT_LOG','Audit ID','OBL-2'),{
    row:projected()[1],rowIndex:3
  });
  assert.equal(await a.findRowIndex_('OPENING_BALANCE_EDIT_LOG','Audit ID','OBL-2'),3);
  assert.equal(await a.findRowIndex_('OPENING_BALANCE_EDIT_LOG','Audit ID','missing'),-1);
  assert.equal(await a.findFirstRow_('OPENING_BALANCE_EDIT_LOG','New Opening Balance','0'),null);
});

test('reader never modifies archived balances and D1 immutable history rejects SQL UPDATE/DELETE',async()=>{
  const beforeRows=(await DB.prepare(archiveSQL).all()).results;
  await adapter().getAllRows_('OPENING_BALANCE_EDIT_LOG');
  await adapter().findRows_('OPENING_BALANCE_EDIT_LOG','Entity ID','C-1');
  const afterRows=(await DB.prepare(archiveSQL).all()).results;
  assert.deepEqual(afterRows,beforeRows);
  await assert.rejects(()=>DB.prepare(
    "UPDATE legacy_opening_balance_edit_audit SET delta_text='9999' WHERE audit_id='OBL-1'"
  ).run(),/immutable|audit/i);
  await assert.rejects(()=>DB.prepare(
    "DELETE FROM legacy_opening_balance_edit_audit WHERE audit_id='OBL-1'"
  ).run(),/immutable|audit/i);
  assert.equal(await count(),2);
});

test('source gap in local D1 returns an error rather than attaching a wrong physical source index',async()=>{
  await DB.prepare(
    'INSERT INTO legacy_opening_balance_edit_audit(legacy_sheet_row,audit_id,entity_type,entity_id) VALUES (?,?,?,?)'
  ).bind(8,'OBL-SYNTHETIC-GAP','CUSTOMER','C-1').run();
  await assert.rejects(()=>adapter().getAllRows_('OPENING_BALANCE_EDIT_LOG'),
    /source|archive|invalid|physical/i);
  assert.equal(await count(),3);
});

test('isolated Worker and DB-free public preview deny opening balance archive RPC and import routes',async()=>{
  for(const path of ['/api/rpc','/__m03_test__/opening-balance-audit','/api/health']){
    const res=await worker.fetch('http://local-only.test'+path,{
      method:'POST',headers:{'Content-Type':'application/json'},body:'{}'
    });
    assert.equal(res.status,404,path);
  }
  const publicResponse=await publicWorker.fetch(new Request('https://erp.invalid/api/rpc',{
    method:'POST',headers:{Origin:'https://erp.invalid','Content-Type':'application/json'},
    body:JSON.stringify({fnName:'getAllRows_',args:['OPENING_BALANCE_EDIT_LOG']})
  }),{DB});
  assert.equal(publicResponse.status,501);
  assert.deepEqual(await publicResponse.json(),{
    success:false,message:'RPC method not migrated'
  });
  const preview=JSON.parse(readFileSync(
    new URL('../../wrangler.preview.jsonc',import.meta.url),'utf8'
  ));
  assert.equal(preview.d1_databases,undefined);
  assert.equal(readFileSync(
    new URL('../../src/index.js',import.meta.url),'utf8'
  ).includes('opening-balance-edit-audit-read'),false);
  assert.equal(readFileSync(
    new URL('../../src/rpc/registry.js',import.meta.url),'utf8'
  ).includes('OPENING_BALANCE_EDIT_LOG'),false);
});
