/**
 * M08 test-only frozen-source comparison, NOT a posting or migration adapter.
 * Purchase.gs stores raw qty*price and raw subtotal. Per-line rounded money
 * here is an ILLUSTRATIVE return-helper projection, not a claimed cash/ledger
 * entry from a historical purchase.
 */
import {
  allocateInvoicePaisa,roundSignedAmountPaisa
} from '../../src/modules/m08-exact-decimal-proposal.js';
import {loadPinnedGASFunctions} from './m08-legacy-source-runner.mjs';

const source=loadPinnedGASFunctions({
  'Utils.gs':['roundMoney_','effectiveTransactionUnitPrice_']
});

const toMinorIllustration=amount=>{
  const minor=Math.round(source.roundMoney_(amount)*100);
  if(!Number.isSafeInteger(minor))
    throw new RangeError('Synthetic source illustration outside safe minor range');
  return minor;
};

/**
 * Execute real pinned helper functions. The raw purchase accumulation is
 * mirrored from Purchase.gs solely to compare already-pinned source arithmetic;
 * its original purchase writer is NOT invoked and no historic postings inferred.
 */
export function compareSourceHelperAndHeader(input){
  const proposal=allocateInvoicePaisa(input); // validate exact intent first
  if(input.lines.some(line=>Object.hasOwn(line,'unitRatio')))
    throw new TypeError('Source helper comparison requires base-unit-only lines');
  const sourcePurchaseRawSubtotal=input.lines.reduce((sum,line)=>
    sum+Number(line.quantity)*Number(line.unitPrice),0);
  const sourcePurchaseRawGrand=Math.max(
    0,sourcePurchaseRawSubtotal-Number(input.discount));
  const perLineAmounts=input.lines.map(line=>{
    const effectiveUnit=source.effectiveTransactionUnitPrice_(
      Number(line.unitPrice),
      sourcePurchaseRawSubtotal,
      sourcePurchaseRawGrand
    );
    return toMinorIllustration(Number(line.quantity)*effectiveUnit);
  });
  const sourceSum=perLineAmounts.reduce((sum,minor)=>sum+minor,0);
  if(!Number.isSafeInteger(sourceSum))
    throw new RangeError('Synthetic illustration total outside safe minor range');
  const proposed=BigInt(proposal.grandPaisa);
  const illustrated=BigInt(sourceSum);
  return {
    sourcePurchaseRawSubtotal,
    sourcePurchaseRawGrand,
    sourceHelperRoundedLinePaisaTotal:String(illustrated),
    candidateHeaderPaisa:proposal.grandPaisa,
    candidateLinePaisaById:Object.fromEntries(
      proposal.lines.map(line=>[line.id,line.netPaisa])
    ),
    perLineMinusHeaderPaisa:String(illustrated-proposed),
    sourceIllustrationOnly:true
  };
}

/** Characterizes the actual legacy Math.round helper, no new mode sign-off. */
export function compareSignedHelperTie(value){
  return {
    sourceHelperRoundedPaisa:String(toMinorIllustration(Number(value))),
    candidateHalfUpPaisa:roundSignedAmountPaisa(value,'HALF_UP'),
    candidateHalfEvenPaisa:roundSignedAmountPaisa(value,'HALF_EVEN'),
    technicalModeApproved:false
  };
}
