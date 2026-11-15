import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {
  originalLegacySalePostingPayloadHash,frozenLegacyHashDeclaration
} from './fixtures/m06-sale-journal-hash-oracle.mjs';
import {hashLegacySalePostingPayload} from '../src/modules/legacy-sale-posting-hash.js';
import {hashCanonicalOperationIntent} from '../src/db/operation-intent-fingerprint.js';
import {salePostingJournalDecision_} from '../src/modules/sale-payments.js';

const legacy=payload=>originalLegacySalePostingPayloadHash(payload);
async function parity(payload){
  const original=legacy(payload);
  const current=await hashLegacySalePostingPayload(payload);
  assert.equal(current,original,'frozen GAS SHA-256 payload hash');
  assert.match(current,/^[0-9a-f]{64}$/);
  return current;
}
async function errorParity(payload,pattern){
  let sourceMessage;
  try{legacy(payload);}catch(err){sourceMessage=err.message;}
  assert.ok(sourceMessage,'the original must reject this payload');
  await assert.rejects(()=>hashLegacySalePostingPayload(payload),err=>{
    assert.equal(err.message,sourceMessage,'exact original failure behavior');
    if(pattern)assert.match(err.message,pattern);
    return true;
  });
}

test('historical GAS SHA-256 oracle extracts original single function unchanged',()=>{
  const text=readFileSync(new URL('../legacy/source/SalePayments.gs',import.meta.url),'utf8');
  const functions=parse(text,{ecmaVersion:'latest'}).body
    .filter(node=>node.type==='FunctionDeclaration'&&node.id.name==='salePostingPayloadHash_');
  assert.equal(functions.length,1);
  assert.equal(frozenLegacyHashDeclaration(),text.slice(functions[0].start,functions[0].end));
});

test('matches signed-byte GAS SHA-256 for synthetic standard paid sale journal',async()=>{
  const payload={
    customerId:'CUS-1',items:[{productId:'PIPE',qty:2,unitPrice:19.5}],
    discount:1.25,paidAmount:37.75,paymentType:'Cash'
  };
  const before=JSON.stringify(payload);
  const hashed=await parity(payload);
  assert.equal(hashed,createHash('sha256').update(before,'utf8').digest('hex'));
  assert.equal(JSON.stringify(payload),before,'pure fingerprint does not edit payload');
});

test('historical split tender amounts and cash change produce original digest',async()=>{
  await parity({
    invoiceId:'INV-2026-1',payments:[
      {rowId:'C-1',method:'Cash',tendered:50,applied:39.75,change:10.25},
      {rowId:'B-2',method:'Bank',bankAccountId:'B-1',applied:25.25}
    ],customerId:'CUS-2',discount:0,operationId:'op-a'
  });
});

test('same value and property insertion order always return stable original hash',async()=>{
  const a={invoiceId:'A',qty:2,price:32.5,child:[true,null,'']};
  const hash=await parity(a);
  for(let n=0;n<5;n++)assert.equal(await hashLegacySalePostingPayload(a),hash);
});

test('historical hash intentionally preserves JSON property insertion order',async()=>{
  const a={customerId:'CUS-1',qty:2};
  const b={qty:2,customerId:'CUS-1'};
  const sourceA=await parity(a),sourceB=await parity(b);
  assert.notEqual(sourceA,sourceB,'legacy journal byte streams differ on key order');
});

test('historical hash is not the M03 canonical operation-intent fingerprint',async()=>{
  const a={customerId:'CUS-1',qty:2};
  const b={qty:2,customerId:'CUS-1'};
  const legacyA=await parity(a);
  const canonicalA=await hashCanonicalOperationIntent({
    tenantId:'tenant-1',actorId:'staff-1',operationType:'sales.post',payload:a
  });
  const canonicalB=await hashCanonicalOperationIntent({
    tenantId:'tenant-1',actorId:'staff-1',operationType:'sales.post',payload:b
  });
  assert.equal(canonicalA,canonicalB,'M03 canonical sorted keys do not depend on JS insertion order');
  assert.notEqual(legacyA,canonicalA,'never interchange historical and new D1 receipt hashes');
});

test('original JSON string escaping: Bangla customer, emoji, quotes and newlines',async()=>{
  await parity({customer:'নবাবী মিষ্টি',product:'তার ১ গজ 🔌',notes:'line 1\n"quoted"\t \\'});
});

test('original JSON stringify retains Unicode surrogate escape behavior',async()=>{
  await parity({notes:'\uD800 lone high surrogate and \uDC00 low surrogate'});
  await parity({notes:'paired \uD83D\uDE80'});
});

test('historical digest uses UTF-8 bytes rather than JS UTF-16 input bytes',async()=>{
  const value={customer:'গ্রাহক',note:'🇧🇩',items:[{sku:'A',qty:2}]};
  const hash=await parity(value);
  assert.equal(hash,createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex'));
  assert.notEqual(hash,createHash('sha256').update(JSON.stringify(value),'utf16le').digest('hex'));
});

test('JSON array order changes historical fingerprint while duplicate values are accepted',async()=>{
  const a={items:[{productId:'A',qty:1},{productId:'B',qty:2}]};
  const b={items:[{productId:'B',qty:2},{productId:'A',qty:1}]};
  assert.notEqual(await parity(a),await parity(b));
  await parity([null,0,true,'0',{x:1}]);
});

test('legacy source accepts JSON numeric coercions exactly rather than inventing validation',async()=>{
  await parity({amount:0,negative:-7.2,scientific:1e20,zero:-0,notANumber:NaN,large:Infinity});
  await parity({flag:false,empty:null,emptyList:[],emptyObject:{}});
});

test('historical length check counts JS string code units, not UTF-8 bytes',async()=>{
  const exactly100k='x'.repeat(99998); // quotes add two chars in JSON
  const oneTooLong='x'.repeat(99999);
  assert.equal(JSON.stringify(exactly100k).length,100000);
  await parity(exactly100k);
  assert.equal(JSON.stringify(oneTooLong).length,100001);
  await errorParity(oneTooLong,/Sale payload is too large/);
});

test('source accepts four-byte Unicode whose UTF-8 size exceeds legacy JS length limit',async()=>{
  const text='🚀'.repeat(49999); // 99998 UTF-16 code units + JSON quotes
  assert.equal(JSON.stringify(text).length,100000);
  assert.ok(Buffer.byteLength(JSON.stringify(text),'utf8')>100000);
  await parity(text);
});

test('null remains valid source payload but undefined and unsupported top-level JSON reject',async()=>{
  await parity(null);
  await errorParity(undefined,/Sale payload is too large/);
  await errorParity(()=>{},/Sale payload is too large/);
});

test('cyclic object and BigInt errors preserve original JSON.stringify failure behavior',async()=>{
  const circular={id:'x'};
  circular.loop=circular;
  await errorParity(circular,/circular|cyclic/i);
  await errorParity({customer:'C',qty:3n},/BigInt/i);
});

test('journal decision uses historical digest only for matching historical evidence',async()=>{
  const hash=await parity({invoiceId:'I-1',items:[{sku:'PIPE',qty:2}]});
  assert.equal(salePostingJournalDecision_(null,hash),'new');
  assert.equal(salePostingJournalDecision_({'Payload Hash':hash,State:'Committed'},hash),'replay');
  assert.equal(salePostingJournalDecision_({'Payload Hash':hash,State:'Writing'},hash),'review');
  assert.equal(salePostingJournalDecision_({'Payload Hash':hash,State:'Needs Review'},hash),'review');
  assert.throws(()=>salePostingJournalDecision_(
    {'Payload Hash':hash,State:'Committed'},'a'.repeat(64)
  ),/different payment payload/);
});
