import test from 'node:test';
import assert from 'node:assert/strict';
import {roleMetadata} from '../src/auth/d1-legacy-rpc.js';

const row=json=>({
  role_name:'Cashier',
  allowed_modules:'sales',
  permissions_json:json,
});

test('duplicate module and action JSON keys must fail closed before staff profile authority',()=>{
  for(const json of [
    '{"sales":{"view":true,"add":true},"sales":{"view":true,"add":false}}',
    '{"sales":{"view":true,"add":true,"add":false}}',
    '{"sales":{"view":true,"add":false,"add":true}}',
    '{"sales":{"view":true},"sales":{"view":false}}',
  ]){
    assert.equal(roleMetadata(row(json)),null,
      'duplicate role keys are not canonical frozen GAS JSON.stringify output');
  }
});

test('canonical original GAS serialized permissions remain source-shaped',()=>{
  const permissions={sales:{
    view:true,add:false,edit:true,delete:'7',backdate:'unlimited',
  }};
  assert.deepEqual(roleMetadata(row(JSON.stringify(permissions))),{
    allowedModules:['sales'],
    permissions,
  });
});
