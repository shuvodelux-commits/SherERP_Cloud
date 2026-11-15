/**
 * M06 internal compatibility only: original GAS SalePayments.gs
 * salePostingPayloadHash_ calculated from JSON.stringify(payload), with
 * the original 100000 UTF-16 code unit limit, UTF-8 SHA-256 lowercase hex.
 * Pinned Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 *
 * This hash is deliberately NOT interchangeable with M03's
 * hashCanonicalOperationIntent(), which is the authoritative domain-
 * separated fingerprint for all NEW D1 operation receipts.
 *
 * No authorization, payload validation, posting journal lookup, D1 read,
 * business mutation, replay permission, RPC or Cloudflare binding exists here.
 * A future import reviewer may compare legacy GAS evidence but must not use
 * this result to authorize or replay a new sale.
 */
export async function hashLegacySalePostingPayload(payload){
  const raw=JSON.stringify(payload);
  if(!raw||raw.length>100000){
    throw new Error('Sale payload is too large.');
  }
  if(typeof globalThis.crypto?.subtle?.digest!=='function'){
    throw new Error('NEEDS_REVIEW: Web Crypto SHA-256 unavailable for legacy sale hash');
  }
  const bytes=new TextEncoder().encode(raw);
  const result=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  if(result.byteLength!==32){
    throw new Error('NEEDS_REVIEW: Invalid legacy sale SHA-256 digest');
  }
  return Array.from(new Uint8Array(result),b=>b.toString(16).padStart(2,'0')).join('');
}
