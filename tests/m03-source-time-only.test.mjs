import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {safeSourceTimeOnly} from '../src/modules/source-time-only.js';

const source=readFileSync(new URL('../legacy/source/Utils.gs',import.meta.url),'utf8');
const start=source.indexOf('function safeTimeOnly_(value) {');
const end=source.indexOf('\n}',start);
assert.ok(start>=0&&end>start,'frozen Utils.gs::safeTimeOnly_ must exist');
const originalFunction=source.slice(start,end+2);

function formatTime(date,timeZone){
  const intl=new Intl.DateTimeFormat('en-GB',{
    timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'
  });
  const parts=intl.formatToParts(date);
  return ['hour','minute','second'].map(type=>
    parts.find(part=>part.type===type).value).join(':');
}

function sourceOracle(value,timeZone='Asia/Dhaka'){
  return runInNewContext(originalFunction+'\nsafeTimeOnly_(value);',{
    value,Session:{getScriptTimeZone(){return timeZone;}},
    Utilities:{formatDate(date,tz,pattern){
      assert.equal(pattern,'HH:mm:ss');
      return formatTime(date,tz);
    }}
  });
}

test('original Utils.gs time-only text contract removes 1899 sheet epoch without shifting wall time',()=>{
  const cases=[
    ['1899-12-30T17:35:01','17:35:01'],
    ['1899-12-30T17:35:01Z','17:35:01'],
    ['1899-12-30T17:35:01.123Z','17:35:01'],
    ['1899-12-30T17:35:01.123+06:00','17:35:01'],
    ['2026-11-15T01:02:03-0500','01:02:03'],
    ['2026-11-15T01:02:03+0600','01:02:03'],
    ['09:05:01','09:05:01'],
    ['9:05','09:05:00'],
    [' 0:00:00 ','00:00:00'],
    [' 12:99 ','12:99:00'],
    ['০৯:৩০','০৯:৩০'],
    ['unparsed clock','unparsed clock'],
    ['09:05:00 trailing','09:05:00 trailing'],
    ['2026-11-15','2026-11-15'],
    [null,''],[undefined,''],[false,''],[0,''],
    [true,'true'],[9,'9'],
  ];
  for(const [value,expected] of cases){
    assert.equal(sourceOracle(value),expected,'source baseline: '+String(value));
    assert.equal(safeSourceTimeOnly(value),expected,'Worker port: '+String(value));
  }
});

test('genuine Date requires explicitly supplied business timezone, never an implicit Worker timezone',()=>{
  const date=new Date('2026-11-15T17:35:01.321Z');
  const before=date.getTime();
  for(const [timeZone,expected] of [
    ['UTC','17:35:01'],
    ['Asia/Dhaka','23:35:01'],
    ['America/New_York','12:35:01']
  ]){
    assert.equal(sourceOracle(date,timeZone),expected,'source '+timeZone);
    assert.equal(safeSourceTimeOnly(date,timeZone),expected,'Worker '+timeZone);
  }
  assert.equal(date.getTime(),before,'input Date never mutated');
});

test('timezone boundary crosses midnight correctly for Date but never adjusts ISO source text',()=>{
  const date=new Date('2026-11-15T19:05:01.500Z');
  assert.equal(sourceOracle(date,'Asia/Dhaka'),'01:05:01');
  assert.equal(safeSourceTimeOnly(date,'Asia/Dhaka'),'01:05:01');
  assert.equal(safeSourceTimeOnly('2026-11-15T19:05:01.500Z','Asia/Dhaka'),'19:05:01');
});

test('malformed/missing Date timezone fails closed, while plain strings need no timezone',()=>{
  const date=new Date('2026-11-15T17:35:01Z');
  for(const tz of [undefined,null,'','   ',42,{},'No/Such_Zone']){
    assert.throws(()=>safeSourceTimeOnly(date,tz),/(time.?zone|Invalid|unknown)/i, String(tz));
  }
  assert.throws(()=>safeSourceTimeOnly(new Date(NaN),'UTC'),/(Invalid|time)/i);
  assert.equal(safeSourceTimeOnly(' 9:05 '),'09:05:00');
});

test('source compatibility preserves string fallback for unexpected but non-falsy input',()=>{
  const cases=[[],['17:00'],{toString(){return '09:01';}},'24:00','9:99:99'];
  for(const value of cases){
    assert.equal(safeSourceTimeOnly(value),sourceOracle(value));
  }
});
