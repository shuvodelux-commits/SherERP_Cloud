import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createTestHarness} from 'wrangler';
import {importSourceOpeningBalanceEditAuditWithD1} from '../../src/db/opening-balance-edit-audit-import.js';
import {summarizeM10OpeningBalanceEditAudit} from '../../src/migration/m10-opening-balance-edit-digest.js';

const inventory=JSON.parse(readFileSync(new URL('../../docs/baseline/schema-inventory.json',import.meta.url),'utf8'));
const harness=createTestHarness({workers:[{configPath:'./wrangler.m02-opening-balance-edit-audit-test.jsonc'}]});
const worker=harness.getWorker('shererp-m02-opening-balance-edit-audit-local-only');
let DB;
const source=()=>[
  {'Audit ID':'OBL-1','Changed At':'2026-11-16T12:00Z',
    'Entity Type':'CUSTOMER','Entity ID':'PARTY-1','Entity Name':'করিম',
    'Old Opening Balance':'-150.00','New Opening Balance':-100.5,
    Delta:49.5,'Current Due Before':'-90.00','Current Due After':-40.5,
    Reason:' সংশোধন ','Changed By':'শুভ',_rowIndex:2},
  {'Audit ID':'OBL-2','Changed At':'2026-11-16T12:05Z',
    'Entity Type':'SUPPLIER','Entity ID':'PARTY-1','Entity Name':'করিম',
    'Old Opening Balance':0,'New Opening Balance':'-0.00',
    Delta:'-0.00','Current Due Before':'','Current Due After':'-0.00',
    Reason:' সাপ্লায়ার ','Changed By':'রহিম',_rowIndex:3}
];
const digest=rows=>summarizeM10OpeningBalanceEditAudit({inventory,rows});

async function storedRows(){
  const r=await DB.prepare('SELECT legacy_sheet_row,audit_id,changed_at_text,entity_type,entity_id,entity_name,old_opening_balance_text,new_opening_balance_text,delta_text,current_due_before_text,current_due_after_text,reason,changed_by FROM legacy_opening_balance_edit_audit ORDER BY legacy_sheet_row ASC').all();
  assert.equal(r.success,true);
  assert.ok(Array.isArray(r.results));
  return r.results.map(x=>({
    'Audit ID':x.audit_id,'Changed At':x.changed_at_text,
    'Entity Type':x.entity_type,'Entity ID':x.entity_id,'Entity Name':x.entity_name,
    'Old Opening Balance':x.old_opening_balance_text,
    'New Opening Balance':x.new_opening_balance_text,
    Delta:x.delta_text,'Current Due Before':x.current_due_before_text,
    'Current Due After':x.current_due_after_text,Reason:x.reason,
    'Changed By':x.changed_by,_rowIndex:x.legacy_sheet_row
  }));
}
before(async()=>{await harness.listen();await worker.applyD1Migrations('DB');({DB}=await worker.getEnv());});
after(async()=>{await harness.close();});

test('M10 original source and independent actual local Workerd/D1 SELECT opening-balance audit hashes agree',async()=>{
  const s=source(),snapshot=structuredClone(s);
  assert.equal((await DB.prepare('SELECT COUNT(*) AS n FROM legacy_opening_balance_edit_audit').first()).n,0);
  const imported=await importSourceOpeningBalanceEditAuditWithD1({DB,sourceRows:s});
  assert.deepEqual(imported,{sourceGroup:'OPENING_BALANCE_EDIT_LOG',importedRows:2,reconciled:true});
  const stored=await storedRows();
  assert.equal(stored[0]['Old Opening Balance'],'-150.00');
  assert.equal(stored[0]['New Opening Balance'],'-100.5');
  assert.equal(stored[1]['Old Opening Balance'],'0');
  assert.equal(stored[1]['New Opening Balance'],'-0.00');
  assert.equal(stored[1].Delta,'-0.00');
  assert.equal(stored[0]['Entity ID'],stored[1]['Entity ID']);
  assert.notEqual(stored[0]['Entity Type'],stored[1]['Entity Type']);
  assert.deepEqual(digest(stored),digest(s));
  assert.deepEqual(s,snapshot);
});

test('actual immutable D1 trigger blocks UPDATE and DELETE without changing hashes',async()=>{
  const before=digest(await storedRows());
  await assert.rejects(()=>DB.prepare("UPDATE legacy_opening_balance_edit_audit SET delta_text='999'").run(),/immutable|audit/i);
  await assert.rejects(()=>DB.prepare('DELETE FROM legacy_opening_balance_edit_audit').run(),/immutable|audit/i);
  assert.deepEqual(digest(await storedRows()),before);
});

test('independent readback copies detect signed-zero/text, Unicode, and due drift without fabricated ID change',async()=>{
  const rows=await storedRows(),before=digest(rows);
  for(const [index,field,replacement] of [
    [1,'New Opening Balance','0.00'],
    [1,'Delta','0'],
    [0,'Current Due After','-40.50'],
    [0,'Reason','সংশোধন'],
    [1,'Entity Type','CUSTOMER']
  ]){
    const changed=structuredClone(rows);changed[index][field]=replacement;
    const after=digest(changed);
    assert.notEqual(after.rowDigest,before.rowDigest,field);
    assert.equal(after.idDigest,before.idDigest,field);
  }
});

test('source Audit ID mismatch and truncated D1 evidence cannot match reviewed original ID digest',async()=>{
  const rows=await storedRows(),original=digest(rows);
  const replaced=structuredClone(rows);replaced[0]['Audit ID']='OBL-TAMPER';
  assert.notEqual(digest(replaced).idDigest,original.idDigest);
  assert.notEqual(digest(replaced).rowDigest,original.rowDigest);
  const shortened=digest(rows.slice(0,1));
  assert.equal(shortened.rowCount,1);
  assert.notEqual(shortened.idDigest,original.idDigest);
  assert.notEqual(shortened.rowDigest,original.rowDigest);
});

test('immutable import rejects a changed replay, no HTTP/Worker import/health/RPC route exists',async()=>{
  const changed=source();changed[1]['Current Due After']='99999';
  await assert.rejects(()=>importSourceOpeningBalanceEditAuditWithD1({DB,sourceRows:changed}),/failed|empty/i);
  assert.deepEqual(digest(await storedRows()),digest(source()));
  for(const path of ['/api/rpc','/__m10__/opening-balance-import','/api/health']){
    const response=await worker.fetch('http://synthetic.local'+path,{method:'POST',body:'{}'});
    assert.equal(response.status,404);
  }
});
