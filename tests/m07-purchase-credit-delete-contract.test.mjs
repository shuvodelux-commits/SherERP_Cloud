import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSyntheticD1PurchaseCreditDeleteContract} from './fixtures/m07-purchase-credit-delete-contract.mjs';

// Independent Node RED acceptance that proves malformed source-linked correction
// inputs are rejected BEFORE any D1 read/write. Actual posting tests in Workerd.
const forbiddenDb={
 prepare(){throw new Error('D1 must not be accessed for invalid input')},
 batch(){throw new Error('D1 must not be batched for invalid input')}
};
const valid=()=>({
 tenantId:'SHOP-A',actorId:'MANAGER',operationId:'OP-SUP-CREDIT-DELETE-001',
 returnId:'PRET-CREDIT-A',purchaseId:'PUR-A',supplierId:'SUP-1',
 sku:'PIPE',lotId:'LOT-PUR-A',originalHash:'a'.repeat(64),
 units:1,creditPaisa:1500,reason:'Correct mistaken Supplier Credit'
});

test('Supplier Credit correction rejects unexpected SQL and untrusted fields before D1',async()=>{
 for(const patch of [{sql:'DELETE FROM m05_purchases'},{partyId:'PARTY-OTHER'},
  {sessionToken:'client-session'},{permission:'admin'}]){
  await assert.rejects(
   ()=>createSyntheticD1PurchaseCreditDeleteContract(forbiddenDb).post({...valid(),...patch}),
   /invalid|shape|synthetic/i
  );
 }
});

test('Supplier Credit correction enforces exact source identity, amount and reason before D1',async()=>{
 for(const patch of [{operationId:'x'},{actorId:''},{supplierId:''},
  {units:0},{units:1.5},{creditPaisa:-1},
  {originalHash:'not-a-hash'},{reason:' '}]){
  await assert.rejects(
   ()=>createSyntheticD1PurchaseCreditDeleteContract(forbiddenDb).post({...valid(),...patch}),
   /invalid|shape|synthetic/i
  );
 }
});
