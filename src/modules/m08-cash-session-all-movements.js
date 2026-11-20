/**
 * M08: READ-ONLY physical Cash Session arithmetic from the ORIGINAL Cash Book.
 *
 * Original source: CashBook.gs:addCashBookEntry_ is the one ledger writer for
 * every genuine cash event, regardless of the ERP module that posted it.
 * CashSession.gs:cashSessionSummaryFromRows_ uses Session Open as the
 * transaction-order boundary and excludes historical opening balances.
 *
 * Use this source-independent projection to audit full cash coverage; it does
 * NOT authenticate callers, post/repair transactions, close a Cash Session,
 * or authorize deployment. SQL-time approval remains with the M03 writer.
 */
const ERROR='Cash Session cash movements unavailable';
const MAX_PAISA=1_000_000_000_000;
const MONEY=/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/;
const historical=type=>type==='Historical Opening'||/^Opening(?:\s|$)/i.test(type);
const synthetic=type=>type==='Day Close Adjustment'||
  type==='Session Close'||type==='Cash Session Close';
const deleted=row=>row['Is Deleted']===true ||
  String(row['Is Deleted']??'').toUpperCase()==='TRUE';

function moneyPaisa(value,{optional=false}={}){
  if(optional&&(value===null||value===undefined||value===''))return null;
  const str=typeof value==='number' && Number.isFinite(value)
    ?String(value):value;
  if(typeof str!=='string'||!MONEY.test(str))throw new Error(ERROR);
  const [whole,fraction='']=str.split('.');
  const amount=Number(whole)*100+Number(fraction.padEnd(2,'0'));
  if(!Number.isSafeInteger(amount)||amount>MAX_PAISA)
    throw new Error(ERROR);
  return amount;
}
function entryPaisa(value){
  if(value===null||value===undefined||value==='')return 0;
  return moneyPaisa(value);
}
const text=value=>typeof value==='string'?value.trim():'';
function safeAdd(a,b){
  if(!Number.isSafeInteger(a+b) || a+b>MAX_PAISA)
    throw new Error(ERROR);
  return a+b;
}
/**
 * Compute one Cash Session's physical drawer totals from the canonical
 * posting-order Cash Book rows, NOT individual invoices, finance or bank rows.
 *
 * Unknown valid cash entry types are deliberately included: a new module's
 * actual Cash Book movement must not be silently omitted. Historical opening
 * adjustments are excluded by explicit Type (including opening liabilities).
 * The first physical float comes exclusively from openingCash, even if a
 * legacy Session Open marker contains its initial baseline credit.
 *
 * Preconditions: caller supplies the complete, active/private Shop Cash Book
 * in append order, with the requested session's Session Open marker. Deleted
 * rows are ignored. Ambiguity and non-cash entries in this Cash Book fail
 * closed; these results alone NEVER authorize an actual Close Day.
 */
export function summarizeAllSessionCash({
  sessionId,openingCash,countedCash=null,cashBookRows
}={}){
  if(!text(sessionId)||sessionId.length>128 ||
     !Array.isArray(cashBookRows) || cashBookRows.length>100000)
    throw new Error(ERROR);
  const openingPaisa=moneyPaisa(openingCash);
  const countedPaisa=moneyPaisa(countedCash,{optional:true});
  let start=-1,next=cashBookRows.length;
  const seen=new Set();
  for(let i=0;i<cashBookRows.length;i++){
    const row=cashBookRows[i];
    if(!row||typeof row!=='object'||Array.isArray(row)||
       typeof row.then==='function')throw new Error(ERROR);
    if(deleted(row))continue;
    const id=text(row['Entry ID']);
    if(!id||id.length>128||seen.has(id))throw new Error(ERROR);
    seen.add(id);
    if(text(row.Type)!=='Session Open')continue;
    const ref=text(row.Reference);
    if(!ref)throw new Error(ERROR);
    if(ref===sessionId){
      if(start!==-1)throw new Error(ERROR);
      start=i;
    }else if(start!==-1&&next===cashBookRows.length){
      next=i;
    }
  }
  if(start===-1)throw new Error(ERROR);
  let cashInPaisa=0,cashOutPaisa=0;
  let actualCashEntries=0,excludedHistoricalEntries=0,excludedSyntheticEntries=0;
  for(let i=start+1;i<next;i++){
    const row=cashBookRows[i];
    if(deleted(row))continue;
    const type=text(row.Type);
    if(!type)throw new Error(ERROR);
    // A historical liability/receivable/owner opening is never a payment.
    if(historical(type)){excludedHistoricalEntries++;continue;}
    // Old synthetic closing differences do not move physical cash.
    if(synthetic(type)){excludedSyntheticEntries++;continue;}
    if(type==='Session Open')throw new Error(ERROR);
    // Bank-only and mobile-only movements belong in the Bank Book, not here.
    // An accidental entry in physical Cash Book must BLOCK, not be skipped.
    const method=text(row['Payment Method'])||'Cash';
    if(method!=='Cash')throw new Error(ERROR);
    const inward=entryPaisa(row.Credit);
    const outward=entryPaisa(row.Debit);
    if((inward===0&&outward===0)||(inward>0&&outward>0))
      throw new Error(ERROR);
    cashInPaisa=safeAdd(cashInPaisa,inward);
    cashOutPaisa=safeAdd(cashOutPaisa,outward);
    actualCashEntries++;
  }
  const expectedPaisa=openingPaisa+cashInPaisa-cashOutPaisa;
  if(!Number.isSafeInteger(expectedPaisa)||Math.abs(expectedPaisa)>MAX_PAISA)
    throw new Error(ERROR);
  const variancePaisa=countedPaisa===null?null:countedPaisa-expectedPaisa;
  if(variancePaisa!==null&&!Number.isSafeInteger(variancePaisa))
    throw new Error(ERROR);
  return Object.freeze({
    sessionId,
    openingPaisa,cashInPaisa,cashOutPaisa,expectedPaisa,
    countedPaisa,variancePaisa,
    actualCashEntries,excludedHistoricalEntries,excludedSyntheticEntries,
    arithmeticValidated:true,
    closeReady:false,
    // Read model only: all future source-module writers remain separate.
    productionReady:false,authorizesPosting:false,
    authorizesRemoteD1Write:false,authorizesCashClose:false
  });
}
