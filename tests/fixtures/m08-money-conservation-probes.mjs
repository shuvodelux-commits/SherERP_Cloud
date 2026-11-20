/**
 * Isolated M08 test-only arithmetic reference, NOT a D1 posting implementation.
 * Only demonstrates selected owner-approved new-shop conservation examples.
 * No production scale, tie-rounding, maximum amount, refund allocation or
 * invoice/actor authorization policy is established by this file.
 */
function canonicalDecimal(value) {
  if(typeof value!=='string'||!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value))
    throw new Error('Canonical decimal text required for this isolated probe');
  const [whole,fraction='']=value.split('.');
  return {digits:BigInt(whole+fraction),scale:fraction.length};
}

/** Exact multiplication as decimal text; never round to integer paisa. */
export function multiplyCanonicalDecimalText(left,right) {
  const a=canonicalDecimal(left);
  const b=canonicalDecimal(right);
  const scale=a.scale+b.scale;
  const digits=(a.digits*b.digits).toString().padStart(scale+1,'0');
  if(scale===0)return digits;
  const whole=digits.slice(0,digits.length-scale);
  const fractional=digits.slice(-scale).replace(/0+$/,'');
  return fractional?whole+'.'+fractional:whole;
}

function requireMinor(value) {
  if(typeof value!=='bigint'||value<0n)
    throw new Error('Invalid synthetic nonnegative integer-paisa amount');
}

/**
 * One eligible source-return total in integer paisa.
 * An M03 SQL writer must authenticate the original obligation, verify the
 * last eligible return, enforce operation-id uniqueness and allocate all lines.
 * The 1-paisa final-adjustment limit here applies ONLY to the two demonstrated
 * synthetic examples; operational bounds await exact M08 engineering signoff.
 */
export function allocateEligibleReturnMinor({
  eligibleMinor,previouslyAllocatedMinor,proposedMinor,isFinalEligible
}) {
  for(const minor of [eligibleMinor,previouslyAllocatedMinor,proposedMinor])requireMinor(minor);
  if(typeof isFinalEligible!=='boolean')
    throw new Error('Invalid final-eligibility marker');
  if(previouslyAllocatedMinor>eligibleMinor)
    throw new Error('Previously allocated amount exceeds eligible source total');
  const remaining=eligibleMinor-previouslyAllocatedMinor;
  if(remaining===0n&&proposedMinor>0n)
    throw new Error('There is no remaining eligible source value');
  if(!isFinalEligible) {
    if(proposedMinor>remaining)
      throw new Error('Proposed return exceeds remaining eligible source value');
    return proposedMinor;
  }
  const delta=remaining-proposedMinor;
  if(delta>1n||delta< -1n)
    throw new Error('Final residual exceeds this one-paisa proof bound');
  return remaining;
}

/**
 * Synthetic ceiling only: verified net cash actually collected less prior
 * money refunds. The remainder is NOT an authorized ledger/store-credit write.
 */
export function proposeCashRefundMinor({
  verifiedCollectedMinor,previouslyRefundedMinor,requestedReturnMinor
}) {
  for(const minor of [verifiedCollectedMinor,previouslyRefundedMinor,requestedReturnMinor])
    requireMinor(minor);
  if(previouslyRefundedMinor>verifiedCollectedMinor)
    throw new Error('Previously refunded amount exceeds verified collected money');
  const remainingCash=verifiedCollectedMinor-previouslyRefundedMinor;
  const cashMinor=requestedReturnMinor<remainingCash?requestedReturnMinor:remainingCash;
  return {cashMinor,noncashRemainderMinor:requestedReturnMinor-cashMinor};
}
