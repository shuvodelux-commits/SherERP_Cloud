/**
 * M08 Run 3: synthetic NEW-shop policy probes ONLY.
 * This suite does not execute an operational D1 writer, authorize a
 * rounding tie policy, or change pinned Mohim source/historical postings.
 * Owner policy: issue #66, comment 7030515664.
 */
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  multiplyCanonicalDecimalText,
  allocateEligibleReturnMinor,
  proposeCashRefundMinor
} from './fixtures/m08-money-conservation-probes.mjs';

test('G08 engineering probe: exact fractional unit cost remains sub-paisa until approved posting boundary',()=>{
  assert.equal(multiplyCanonicalDecimalText('0.5','10.005'),'5.0025');
  assert.notEqual(multiplyCanonicalDecimalText('0.5','10.005'),'5.00');
  assert.equal(multiplyCanonicalDecimalText('1.2500','2.000'),'2.5');
  assert.equal(multiplyCanonicalDecimalText('0','10.005'),'0');
});

test('decimal reference refuses noncanonical inputs rather than inferring an unsigned production policy',()=>{
  for(const value of ['-0','-1','NaN','Infinity','1e3','01.00','1,000','']){
    assert.throws(()=>multiplyCanonicalDecimalText(value,'1'),/Canonical decimal/);
  }
});

test('owner-approved new-shop final return assigns bounded one-paisa residual only to last eligible return',()=>{
  const first=allocateEligibleReturnMinor({
    eligibleMinor:100n,previouslyAllocatedMinor:0n,proposedMinor:33n,isFinalEligible:false
  });
  const second=allocateEligibleReturnMinor({
    eligibleMinor:100n,previouslyAllocatedMinor:first,proposedMinor:33n,isFinalEligible:false
  });
  const last=allocateEligibleReturnMinor({
    eligibleMinor:100n,previouslyAllocatedMinor:first+second,
    proposedMinor:33n,isFinalEligible:true
  });
  assert.deepEqual([first,second,last],[33n,33n,34n]);
  assert.equal(first+second+last,100n);
});

test('a final return cannot credit beyond its original eligible source amount',()=>{
  assert.equal(allocateEligibleReturnMinor({
    eligibleMinor:100n,previouslyAllocatedMinor:85n,
    proposedMinor:14n,isFinalEligible:true
  }),15n);
  assert.throws(()=>allocateEligibleReturnMinor({
    eligibleMinor:100n,previouslyAllocatedMinor:99n,
    proposedMinor:2n,isFinalEligible:false
  }),/exceeds remaining eligible/);
  assert.throws(()=>allocateEligibleReturnMinor({
    eligibleMinor:100n,previouslyAllocatedMinor:100n,
    proposedMinor:1n,isFinalEligible:true
  }),/no remaining eligible/);
});

test('return reference rejects impossible negative or over-allocated source evidence',()=>{
  for(const input of [
    {eligibleMinor:-1n,previouslyAllocatedMinor:0n,proposedMinor:0n,isFinalEligible:false},
    {eligibleMinor:100n,previouslyAllocatedMinor:101n,proposedMinor:0n,isFinalEligible:false},
    {eligibleMinor:100n,previouslyAllocatedMinor:0n,proposedMinor:-1n,isFinalEligible:false}
  ])assert.throws(()=>allocateEligibleReturnMinor(input),/Invalid|exceeds/);
});

test('owner-approved refund ceiling: unpaid invoice cannot invent a cash refund',()=>{
  assert.deepEqual(proposeCashRefundMinor({
    verifiedCollectedMinor:0n,previouslyRefundedMinor:0n,requestedReturnMinor:75n
  }),{cashMinor:0n,noncashRemainderMinor:75n});
});

test('partial refund reserves prior money reimbursements before proposing more cash',()=>{
  assert.deepEqual(proposeCashRefundMinor({
    verifiedCollectedMinor:100n,previouslyRefundedMinor:40n,requestedReturnMinor:80n
  }),{cashMinor:60n,noncashRemainderMinor:20n});
  assert.deepEqual(proposeCashRefundMinor({
    verifiedCollectedMinor:100n,previouslyRefundedMinor:100n,requestedReturnMinor:20n
  }),{cashMinor:0n,noncashRemainderMinor:20n});
});

test('refund proposal fails closed on impossible collected/refunded evidence and is pure',()=>{
  const input={verifiedCollectedMinor:100n,previouslyRefundedMinor:40n,requestedReturnMinor:30n};
  const original={...input};
  assert.deepEqual(proposeCashRefundMinor(input),{cashMinor:30n,noncashRemainderMinor:0n});
  assert.deepEqual(input,original);
  assert.throws(()=>proposeCashRefundMinor({
    verifiedCollectedMinor:100n,previouslyRefundedMinor:101n,requestedReturnMinor:1n
  }),/exceeds verified/);
  assert.throws(()=>proposeCashRefundMinor({
    verifiedCollectedMinor:100n,previouslyRefundedMinor:0n,requestedReturnMinor:-1n
  }),/Invalid/);
});
