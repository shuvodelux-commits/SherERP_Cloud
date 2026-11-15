import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {safeSourceDateOnly} from '../src/modules/source-date-only.js';

const utils=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
function extract(name){
  const r=new RegExp('^function '+name+'\\([^\\n]*\\) \\{[\\s\\S]*?^\\}', 'm');
  const match=utils.match(r);
  assert.ok(match,'frozen source Utils.gs '+name+' required');
  return match[0];
}
const frozen=[extract('formatDate_'),extract('safeDateOnly_')].join('\n');

function gasDate(date,tz,format){
  assert.equal(format,'yyyy-MM-dd');
  const formatter=new Intl.DateTimeFormat('en-CA',{
    timeZone:tz,year:'numeric',month:'2-digit',day:'2-digit'
  });
  const parts=formatter.formatToParts(date);
  return ['year','month','day'].map(key=>
    parts.find(p=>p.type===key).value).join('-');
}
function sourceOracle(value,zone='Asia/Dhaka'){
  return runInNewContext(frozen+'\nsafeDateOnly_(value);',{
    value,
    Session:{getScriptTimeZone(){return zone;}},
    Utilities:{formatDate:gasDate}
  });
}
const compare=(value,zone,expected)=>{
  assert.equal(sourceOracle(value,zone),expected,'pinned GAS source oracle '+String(value));
  assert.equal(safeSourceDateOnly(value,zone),expected,'Worker utility '+String(value));
};

test('frozen Utils.gs date formatter uses explicit business date, not UTC text slicing',()=>{
  compare('2026-11-15T20:30:00Z','Asia/Dhaka','2026-11-16');
  compare('2026-11-15T00:15:00Z','America/New_York','2026-11-14');
  compare('2026-11-15T00:15:00Z','UTC','2026-11-15');
  compare('2026-11-15','America/New_York','2026-11-14');
  compare('2026-11-15','Asia/Dhaka','2026-11-15');
  compare('2026-11-15T08:05:09+06:00','Asia/Dhaka','2026-11-15');
});

test('Date object and epoch value follow original new Date conversion with no mutation',()=>{
  const date=new Date('2026-11-15T22:40:01.032Z');
  const before=date.getTime();
  compare(date,'Asia/Dhaka','2026-11-16');
  compare(date,'UTC','2026-11-15');
  compare(123,'Asia/Dhaka','1970-01-01');
  compare(true,'UTC','1970-01-01');
  assert.equal(date.getTime(),before);
});

test('invalid date text and broken Date preserve source fallback first ten characters',()=>{
  for(const value of [
    'garbled text','  not-a-date  ','', ' ', '০১-১২-২০২৬',
    new Date(NaN),Number.POSITIVE_INFINITY,Symbol('x')
  ]){
    const expected=sourceOracle(value,'Asia/Dhaka');
    assert.equal(safeSourceDateOnly(value,'Asia/Dhaka'),expected,
      'GAS source failure fallback for '+String(value));
  }
  assert.equal(safeSourceDateOnly('not a real date','Asia/Dhaka'),'not a real');
  assert.equal(safeSourceDateOnly(new Date(NaN),'UTC'),'Invalid Da');
});

test('source falsy values stay blank and do not require a timezone',()=>{
  for(const value of [null,undefined,false,0,NaN,'']){
    assert.equal(sourceOracle(value),'');
    assert.equal(safeSourceDateOnly(value),'');
  }
});

test('nonempty dates fail closed without a trusted explicit IANA timezone',()=>{
  const date=new Date('2026-11-15T20:30:00Z');
  for(const zone of [undefined,null,'','   ',42,{},'No/Such_Zone']){
    assert.throws(()=>safeSourceDateOnly(date,zone),/time.?zone|invalid|unknown/i);
    assert.throws(()=>safeSourceDateOnly('2026-11-15',zone),/time.?zone|invalid|unknown/i);
  }
  assert.equal(safeSourceDateOnly('',undefined),'');
});

test('source implementation is an independent, fail-closed, dependency-free utility',()=>{
  const source=readFileSync(new URL('../src/modules/source-date-only.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/SpreadsheetApp|Session\.|Utilities\.|google\.script\.run|src\/db|Date\.now\(\)/);
  assert.doesNotMatch(source,/import\s/);
  assert.doesNotMatch(source,/export.*create.*Reader/);
});
