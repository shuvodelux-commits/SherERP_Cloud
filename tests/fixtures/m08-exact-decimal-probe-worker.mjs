/**
 * LOCAL-ONLY Workerd arithmetic compatibility probe. Never included by the
 * production/private-staging Worker profiles or their public RPC registry.
 * Probe does NOT write database, authorize money or expose ERP functionality.
 */
import {
  quoteExactLine,allocateInvoicePaisa,quoteFinalSupplierReturnPaisa,
  quoteCashRefundPaisa,roundSignedAmountPaisa
} from '../../src/modules/m08-exact-decimal-proposal.js';
const paths=Object.freeze({
  line:quoteExactLine,
  invoice:allocateInvoicePaisa,
  'supplier-return':quoteFinalSupplierReturnPaisa,
  'cash-refund':quoteCashRefundPaisa,
  signed:roundSignedAmountPaisa
});
export default {
  async fetch(request) {
    const url=new URL(request.url);
    if(url.pathname!=='/__m08_local_probe__'||request.method!=='POST')
      return Response.json({error:'Not found'},{status:404});
    try {
      const input=await request.json();
      if(!input||typeof input!=='object'||Array.isArray(input)||
          !Object.hasOwn(paths,input.kind))
        throw new TypeError('Invalid M08 local probe type');
      const result= input.kind==='signed'
        ? roundSignedAmountPaisa(input.value,input.roundingMode)
        : paths[input.kind](input.value);
      return Response.json({result},{headers:{'Cache-Control':'no-store'}});
    } catch(error) {
      if(error instanceof RangeError||error instanceof TypeError)
        return Response.json({error:error.name},{status:422});
      return Response.json({error:'Internal error'},{status:500});
    }
  }
};
