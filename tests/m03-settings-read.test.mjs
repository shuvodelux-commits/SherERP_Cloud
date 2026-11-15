import test from 'node:test';
import assert from 'node:assert/strict';
import {isSettingEnabled_,createSettingsReadAdapter} from '../src/db/settings-read.js';

test('Settings boolean helper preserves pinned Utils.gs source semantics for Sheets and D1',()=>{
  for(const value of [true,'true','TRUE',' TrUe\t']) {
    assert.equal(isSettingEnabled_(value),true,String(value));
    assert.equal(isSettingEnabled_(value,true),true,String(value));
  }
  for(const value of [false,'false','FALSE',' FaLsE ']) {
    assert.equal(isSettingEnabled_(value),false,String(value));
    assert.equal(isSettingEnabled_(value,true),false,String(value));
  }
  for(const value of [null,undefined,'',' ','yes','1',1,0,{},[]]) {
    assert.equal(isSettingEnabled_(value),false,String(value));
    assert.equal(isSettingEnabled_(value,true),true,String(value));
    assert.equal(isSettingEnabled_(value,1),false,String(value));
  }
});

test('Settings reader validates its D1 binding immediately, no module cache or implicit fallback',()=>{
  assert.throws(()=>createSettingsReadAdapter({}),/D1|binding/i);
  assert.throws(()=>createSettingsReadAdapter({DB:null}),/D1|binding/i);
  assert.throws(()=>createSettingsReadAdapter({DB:{prepare:null}}),/D1|binding/i);
});
