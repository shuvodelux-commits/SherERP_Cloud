/**
 * M08 Run 4 — frozen-source helper versus exact-money candidate characterization.
 * Synthetic non-posting accounting evidence ONLY, not historical cash/ledger rows.
 * Purchase.gs stores source line totals as raw qty*unitPrice, not these
 * illustrative per-line rounded return projections.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  compareSourceHelperAndHeader,
  compareSignedHelperTie
} from './fixtures/m08-run4-rounding-drift-observer.mjs';

const threeLines=[
  {id:'C',quantity:'1',unitPrice:'0.335'},
  {id:'A',quantity:'1',unitPrice:'0.335'},
  {id:'B',quantity:'1',unitPrice:'0.335'}
];

test('frozen source keeps raw fractional purchase subtotal; illustrative rounded lines can exceed a once-rounded header',()=>{
  const x=compareSourceHelperAndHeader({
    lines:threeLines,discount:'0',roundingMode:'HALF_UP'
  });
  assert.ok(Math.abs(x.sourcePurchaseRawSubtotal-1.005)<1e-12);
  assert.equal(x.candidateHeaderPaisa,'101');
  assert.equal(x.sourceHelperRoundedLinePaisaTotal,'102');
  assert.equal(x.perLineMinusHeaderPaisa,'1');
  assert.deepEqual(x.candidateLinePaisaById,{C:'33',A:'34',B:'34'});
  assert.equal(x.sourceIllustrationOnly,true);
});

test('two half-paisa source helper lines illustrate a one-paisa double-rounding mismatch',()=>{
  const x=compareSourceHelperAndHeader({
    lines:[{id:'A',quantity:'1',unitPrice:'0.005'},
           {id:'B',quantity:'1',unitPrice:'0.005'}],
    discount:'0',roundingMode:'HALF_UP'
  });
  assert.equal(x.candidateHeaderPaisa,'1');
  assert.equal(x.sourceHelperRoundedLinePaisaTotal,'2');
  assert.equal(x.perLineMinusHeaderPaisa,'1');
  assert.deepEqual(x.candidateLinePaisaById,{A:'1',B:'0'});
});

test('discounted source effective-return helper can leave one-paisa gap versus candidate invoice header',()=>{
  const x=compareSourceHelperAndHeader({
    lines:threeLines,discount:'0.005',roundingMode:'HALF_UP'
  });
  assert.equal(x.candidateHeaderPaisa,'100');
  assert.equal(x.sourceHelperRoundedLinePaisaTotal,'99');
  assert.equal(x.perLineMinusHeaderPaisa,'-1');
  assert.equal(x.candidateLinePaisaById.A,'34');
  assert.equal(x.sourceIllustrationOnly,true);
});

test('the signed half-paisa negative tie differs between original helper and candidate HALF_UP',()=>{
  const t=compareSignedHelperTie('-0.005');
  assert.equal(t.sourceHelperRoundedPaisa,'0');
  assert.equal(t.candidateHalfUpPaisa,'-1');
  assert.equal(t.candidateHalfEvenPaisa,'0');
  assert.equal(t.technicalModeApproved,false);
});

test('source illustration and immutable-ID candidate allocation are stable under reordered input',()=>{
  const x=compareSourceHelperAndHeader({lines:threeLines,discount:'0',roundingMode:'HALF_UP'});
  const y=compareSourceHelperAndHeader({lines:threeLines.toReversed(),discount:'0',roundingMode:'HALF_UP'});
  assert.equal(x.candidateHeaderPaisa,y.candidateHeaderPaisa);
  assert.equal(x.sourceHelperRoundedLinePaisaTotal,y.sourceHelperRoundedLinePaisaTotal);
  assert.deepEqual(x.candidateLinePaisaById,y.candidateLinePaisaById);
});

test('observer is nonmutating and rejects invalid candidate intent rather than leaking an assumed posting rule',()=>{
  const lines=structuredClone(threeLines);
  const before=structuredClone(lines);
  assert.throws(()=>compareSourceHelperAndHeader({
    lines,discount:'0',roundingMode:'UNAPPROVED'
  }),/rounding mode/i);
  assert.deepEqual(lines,before);
});
