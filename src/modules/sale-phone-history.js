/**
 * M06: source-faithful, internal-only past-sale phone lookup projection.
 * Original: Invoice.gs::findSalesByPhone + Utils.gs (frozen source manifest).
 *
 * The future D1 reader MUST validate the M04 pos.view permission before
 * supplying tenant-scoped source rows and M08 settlement evidence. No RPC,
 * token, database, write, customer auto-merge or Party accounting lives here.
 */
const plain=value=>value!==null && typeof value==='object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value)===Object.prototype ||
   Object.getPrototypeOf(value)===null);

function phoneDisplay(value){
  const text=String(value??'').trim();
  return /^1[3-9]\d{8}$/.test(text)?'0'+text:text;
}

function phoneSearch(value){
  const bnDigits='০১২৩৪৫৬৭৮৯';
  const ascii=phoneDisplay(value).replace(/[০-৯]/g,d=>
    String(bnDigits.indexOf(d)));
  let digits=ascii.replace(/\D/g,'');
  if(/^8801[3-9]\d{8}$/.test(digits))digits='0'+digits.slice(3);
  else if(/^1[3-9]\d{8}$/.test(digits))digits='0'+digits;
  return digits;
}

function timeOnly(value){
  if(!value)return '';
  if(typeof value!=='string')throw new TypeError('Invalid source sale time');
  const text=value.trim();
  const iso=text.match(/T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if(iso)return iso[1];
  const hms=text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  return hms?String(hms[1]).padStart(2,'0')+':'+hms[2]+':'+(hms[3]||'00'):text;
}

function dateOnly(value){
  if(!value)return '';
  if(typeof value!=='string')throw new TypeError('Invalid canonical source sale date');
  return value.slice(0,10);
}

const deleted=row=>String(row['Is Deleted']||'').toUpperCase()==='TRUE';

/**
 * @param {{phone: string, customerId?: string}} query
 * @param {{saleRows: Array<object>, settlementStatusByInvoice: object}} snapshot
 * @returns {Array<{invoiceId:string,date:string,time:string,customerName:string,
 *                  grandTotal:number,paymentStatus:string,duplicateInvoiceId:boolean}>}
 *
 * Required input is an already-authorized, consistent source-shaped read;
 * this is NOT permission to fetch Customer history from client input alone.
 */
export function projectSalePhoneHistory(query,snapshot){
  if(!plain(query) || (typeof query.phone!=='string' && typeof query.phone!=='number') ||
    (query.customerId!==undefined && typeof query.customerId!=='string')){
    throw new TypeError('Invalid POS phone-history query');
  }
  if(!plain(snapshot) || !Array.isArray(snapshot.saleRows) ||
    !plain(snapshot.settlementStatusByInvoice)){
    throw new TypeError('Missing trusted POS phone-history snapshot and settlement evidence');
  }
  const phone=phoneDisplay(query.phone);
  if(!phone)throw new Error('Enter a phone number.');
  const customerId=(query.customerId||'').trim();
  const needle=phoneSearch(phone);
  const active=snapshot.saleRows.filter(row=>!deleted(row));
  const duplicates=Object.create(null);
  for(const row of active){
    const id=String(row['Invoice ID']||'').trim();
    if(id)duplicates[id]=(duplicates[id]||0)+1;
  }
  const matches=active.filter(row=>{
    const sourceId=String(row['Customer ID']||'');
    const byCustomer=!!customerId && sourceId===customerId;
    const rowPhone=phoneSearch(row['Customer Phone']);
    return byCustomer || (!!needle && !!rowPhone && rowPhone===needle);
  }).sort((a,b)=>new Date(b['Created At'])-new Date(a['Created At']));
  return matches.map(row=>{
    const invoiceId=String(row['Invoice ID']||'');
    const ambiguous=(duplicates[invoiceId]||0)>1;
    const sourceCustomerId=String(row['Customer ID']||'');
    let paymentStatus=row['Payment Status'];
    if(!ambiguous && sourceCustomerId &&
      (Number(row['Due Amount'])||0)>.004 &&
      Object.hasOwn(snapshot.settlementStatusByInvoice,invoiceId)){
      const computed=snapshot.settlementStatusByInvoice[invoiceId];
      if(typeof computed!=='string'){
        throw new TypeError('Invalid trusted Customer settlement status');
      }
      if(computed)paymentStatus=computed;
    }
    return {
      invoiceId,date:dateOnly(row['Date']),time:timeOnly(row['Time']),
      customerName:row['Customer Name'],grandTotal:row['Grand Total'],
      paymentStatus,duplicateInvoiceId:ambiguous
    };
  });
}
