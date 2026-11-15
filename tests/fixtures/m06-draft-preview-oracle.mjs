import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';

// Test ONLY: run exact pinned GAS functions with read-only trusted snapshots.
// Never import this file from a Worker service or open an RPC from it.
const sources=[
  ['SalePayments.gs','dd08b0c1e27a799c9c16feda50239f172eb7eb4f'],
  ['DraftSales.gs','e34b220f97d4995be2f851c7145737d2eae1b335']
];
const readPinned = ([name,sha]) => {
  const bytes=readFileSync(new URL('../../legacy/source/'+name,import.meta.url));
  const found=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if(found!==sha) throw new Error(name+' differs from pinned original source');
  return bytes.toString('utf8');
};
const plain=value=>JSON.parse(JSON.stringify(value));

export function createM06NativeDraftOracle({paymentAccounts,shop}) {
  const scope={
    getAllRows_(group) {
      if(group!=='BANK_ACCOUNTS') throw new Error('Unexpected GAS read in source draft preview: '+group);
      return structuredClone(paymentAccounts);
    },
    getSettingsMap_:()=>({}),
    buildInvoiceShopPayload_:()=>structuredClone(shop),
    normalizeCustomerRelationType_:value=>String(value||'').trim()==='Husband' ? 'Husband' : 'Father',
    // Canonical D1 date strings only; the original GAS date-object timezone
    // formatter remains a separate M03 repository boundary responsibility.
    safeDateOnly_:value=>value ? String(value).slice(0,10) : ''
  };
  const context=vm.createContext(scope);
  for (const src of sources) vm.runInContext(readPinned(src),context,{filename:src[0],timeout:1000});
  return {
    parse:row=>plain(context.parseSalesDraftRow_(structuredClone(row))),
    preview:row=>plain(context.buildSalesDraftPreviewPayload_(structuredClone(row)))
  };
}
