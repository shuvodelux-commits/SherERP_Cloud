import test from 'node:test';
import assert from 'node:assert/strict';
import {canonicalStaffLoginPhone,loginStaffForShop,validateStaffForShop,revokeStaffForShop}
  from '../src/auth/m04-shop-staff-session-scope.js';

const shopId='11111111-1111-4111-8111-111111111111';
const dbId='22222222-2222-4222-8222-222222222222';
const marker='33333333-3333-4333-8333-333333333333';
const NO_DB=()=>({prepare(){throw new Error('Untrusted input must not touch D1');}});
const scope={shopId,databaseId:dbId,databaseMarker:marker,shopDb:NO_DB()};
const request=(patch={})=>({selectedShopId:shopId,mobile:'01712345678',password:'StrongPassword123',...patch});

test('source-compatible Bangladeshi staff phone formats normalize without accepting arbitrary noise',()=>{
  assert.equal(canonicalStaffLoginPhone('01712345678'),'01712345678');
  assert.equal(canonicalStaffLoginPhone('+8801712345678'),'01712345678');
  assert.equal(canonicalStaffLoginPhone('০১৭১২৩৪৫৬৭৮'),'01712345678');
  assert.equal(canonicalStaffLoginPhone('1712345678'),'01712345678');
  for(const input of ['x01712345678','01712345678<script>',{},null,'123','01123456789',
    '01712345678x'])assert.equal(canonicalStaffLoginPhone(input),null);
});

test('wrong Shop, forged actor/role and accessor-bearing input deny before D1 access',async()=>{
  const forged={...request(),role:'Administrator'};
  const accessor=Object.defineProperty(request(),'mobile',{get(){throw Error('Untrusted getter');}});
  for(const data of [
    request({selectedShopId:'44444444-4444-4444-8444-444444444444'}),
    request({mobile:'invalid'}),request({password:''}),forged,accessor
  ]){
    assert.deepEqual(await loginStaffForShop(scope,data),{authenticated:false});
  }
  assert.deepEqual(await loginStaffForShop(scope,request()),{authenticated:false},
    'a Shop without the reviewed M04 schema must stay unavailable');
  const token='a'.repeat(64);
  assert.deepEqual(await validateStaffForShop(scope,{
    selectedShopId:'44444444-4444-4444-8444-444444444444',token
  }),{authenticated:false});
  assert.deepEqual(await revokeStaffForShop(scope,{
    selectedShopId:'44444444-4444-4444-8444-444444444444',token
  }),{revoked:false});
});
