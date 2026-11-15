import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

// Test-only oracle for the immutable Mohim_ERP source; NOT a Worker runtime,
// payment service, D1 adapter or authorization bypass.
const relativePath='legacy/source/SalePayments.gs';
const expectedBlob='dd08b0c1e27a799c9c16feda50239f172eb7eb4f';
const sourceUrl=new URL('../../legacy/source/SalePayments.gs',import.meta.url);
const copy=value=>structuredClone(value);

export function createNativeSalePaymentOracle() {
  const bytes=readFileSync(sourceUrl);
  const blobHash=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if (blobHash!==expectedBlob) throw new Error('M06 payment reference source does not match pinned Git blob.');
  const context=vm.createContext({});
  vm.runInContext(bytes.toString('utf8'),context,{filename:relativePath,timeout:1000});

  return Object.freeze({
    origin:relativePath,
    normalize:(total,rows,accounts)=>copy(context.normalizeSalePayments_(total,rows,accounts)),
    breakdown:(sale,children)=>copy(context.readSalePaymentBreakdown_(sale,children)),
    accountDeltas:(previous,replacement)=>copy(context.salePaymentAccountDeltas_(previous,replacement)),
    assertBookEvidence:(id,payments,cashRows,bankRows)=>context.assertSalePaymentBookEvidence_(id,payments,cashRows,bankRows),
    journalDecision:(existing,payloadHash)=>context.salePostingJournalDecision_(existing,payloadHash)
  });
}
