import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  inspectFrozenCashSessionSourceContract
} from '../src/auth/m04-cash-session-source-permission-contract.js';

const original=readFileSync(
  new URL('../legacy/source/CashSession.gs',import.meta.url),'utf8'
);
const mismatch=/Cash Session source contract mismatch/i;

function changeWithin(name,from,to){
  const start=original.indexOf('function '+name+'(');
  assert.ok(start>=0,'pinned source function must exist: '+name);
  const end=original.indexOf('\nfunction ',start+1);
  const at=end<0?original.length:end;
  const target=original.slice(start,at);
  assert.ok(target.includes(from),'pinned source fragment must exist');
  return original.slice(0,start)+target.replace(from,to)+original.slice(at);
}
const check=s=>inspectFrozenCashSessionSourceContract(s);

test('pinned source defines three exact public permissions and a private Open-only posting guard',()=>{
  const actual=check(original);
  assert.deepEqual(actual,{
    sourceContractVerified:true,
    operations:{
      startCashSession:{module:'pos',action:'add'},
      closeCashSession:{module:'pos',action:'add'},
      getCashSessionSummary:{module:'pos',action:'view'},
    },
    privateOnly:['getActiveCashSession_','requireActiveCashSession_'],
    postingStatus:'Open',
    operationalAuthorization:false,
    productionPostingAllowed:false,
  });
});

test('rejects missing public functions, duplicate declarations and unexpected public alias',()=>{
  const missing=original.replace('function startCashSession(', 'function oldStartCashSession(');
  assert.throws(()=>check(missing),mismatch);
  const duplicate=original+'\nfunction closeCashSession(token) { requirePermission_(token, "pos", "add"); }';
  assert.throws(()=>check(duplicate),mismatch);
  assert.throws(()=>check(original+'\nfunction getActiveCashSession() {return null;}'),mismatch);
});

test('rejects add-versus-edit and view-versus-add permission drift for all three public actions',()=>{
  assert.throws(()=>check(changeWithin('startCashSession',
    "requirePermission_(token, 'pos', 'add');",
    "requirePermission_(token, 'pos', 'edit');")),mismatch);
  assert.throws(()=>check(changeWithin('closeCashSession',
    "requirePermission_(token, 'pos', 'add');",
    "requirePermission_(token, 'pos', 'edit');")),mismatch);
  assert.throws(()=>check(changeWithin('getCashSessionSummary',
    "requirePermission_(token, 'pos', 'view');",
    "requirePermission_(token, 'pos', 'add');")),mismatch);
});

test('cannot replace actual token authority with a comment, forged user or extra permission call',()=>{
  const noCall=changeWithin('closeCashSession',
    "requirePermission_(token, 'pos', 'add');",
    "// requirePermission_(token, 'pos', 'add');");
  assert.throws(()=>check(noCall),mismatch);
  const forged=changeWithin('getCashSessionSummary',
    "requirePermission_(token, 'pos', 'view');",
    "requirePermission_(actor, 'pos', 'view');");
  assert.throws(()=>check(forged),mismatch);
  const extra=changeWithin('startCashSession',
    "requirePermission_(token, 'pos', 'add');",
    "requirePermission_(token, 'pos', 'add'); requirePermission_(token, 'pos', 'view');");
  assert.throws(()=>check(extra),mismatch);
});

test('permission check must precede ordinary function operations in the source try block',()=>{
  const later=changeWithin('startCashSession',
    "requirePermission_(token, 'pos', 'add');",
    "getAllRows_('CASH_SESSIONS'); requirePermission_(token, 'pos', 'add');");
  assert.throws(()=>check(later),mismatch);
});

test('posting stays Open-only, never Closing, Starting or merely non-Closed',()=>{
  assert.throws(()=>check(changeWithin('requireActiveCashSession_',
    "result.data['Status'] !== 'Open'",
    "result.data['Status'] !== 'Closing'")),mismatch);
  assert.throws(()=>check(changeWithin('requireActiveCashSession_',
    "result.data['Status'] !== 'Open'",
    "result.data['Status'] === 'Closed'")),mismatch);
  assert.throws(()=>check(changeWithin('requireActiveCashSession_',
    "result.data['Status'] !== 'Open'",
    "result.data['Status'] != 'Open'")),mismatch);
});

test('private function definitions must exist, preserving server-only Cash Session inspection',()=>{
  assert.throws(()=>check(original.replace(
    'function getActiveCashSession_(', 'function getActiveCashSessionDeleted_(')),mismatch);
  assert.throws(()=>check(original.replace(
    'function requireActiveCashSession_(', 'function requireCashSessionDeleted_(')),mismatch);
});

test('rejects untrusted input, malformed source and oversized source',()=>{
  for(const value of [null,undefined,{},[],0,'','invalid ***','\0', 'x'.repeat(110000)]){
    assert.throws(()=>check(value),mismatch);
  }
});
