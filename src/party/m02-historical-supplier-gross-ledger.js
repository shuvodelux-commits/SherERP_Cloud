/**
 * M02 Run 10 — strictly OFFLINE, source-shaped Supplier gross-ledger auditor.
 *
 * No imports into production, no D1/remote reads or writes, no accounting
 * posting and no historical approval. All diagnostics are redacted codes.
 * Source pin: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 */
const MAX_MINOR=9007199254740991n;
const genericError=()=>new Error('Historical Supplier ledger audit unavailable');
const shape=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const literalID=x=>typeof x==='string'&&x.length>0&&x.trim().length>0;
const physicalRow=x=>Number.isSafeInteger(x)&&x>=2;
const deleted=x=>x?.['Is Deleted']===true||
  String(x?.['Is Deleted']??'').trim().toUpperCase()==='TRUE';

/**
 * Requiring original decimal TEXT is deliberate: JSON Number may have
 * already lost a paisa before the audit begins. Unsupported values fail,
 * never coerce/round. Blank debit or credit cells mean source zero.
 */
function money(raw,blank=false) {
  if(raw===''&&blank)return 0n;
  if(typeof raw!=='string')throw genericError();
  const neg=raw.startsWith('-');
  const lexeme=neg?raw.slice(1):raw;
  if(!/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?$/.test(lexeme))
    throw genericError();
  const [whole,frac='']=lexeme.split('.');
  const amount=BigInt(whole)*100n+BigInt(frac.padEnd(2,'0'));
  if(amount>MAX_MINOR||(neg&&amount===0n))throw genericError();
  return neg?-amount:amount;
}
function nonnegativeCounter(map,code) {
  map.set(code,(map.get(code)||0)+1);
}
function sourceRows(rows,group,idField,codePrefix,block) {
  const byId=new Map(),physical=new Set(),repeatedIds=new Set();
  for(const row of rows){
    if(!physicalRow(row._rowIndex))block(codePrefix+'_ROW_PROVENANCE_INVALID');
    else if(physical.has(row._rowIndex))block('DUPLICATE_'+codePrefix+'_SHEET_ROW');
    else physical.add(row._rowIndex);
    const id=row[idField];
    if(!literalID(id)){
      block(codePrefix+'_ID_REQUIRED');
      continue;
    }
    if(byId.has(id)||repeatedIds.has(id)){
      block('DUPLICATE_'+codePrefix+'_ID');
      repeatedIds.add(id);
      byId.delete(id);
    }else byId.set(id,row);
  }
  return byId;
}
const amount=(raw,blank,block,code)=>{
  try{return money(raw,blank);}
  catch{block(code);return null;}
};
const safeSum=(a,b,block)=>{
  const v=a+b;
  if(v>MAX_MINOR||v< -MAX_MINOR){
    block('SUPPLIER_RUNNING_SUM_UNSAFE');return null;
  }
  return v;
};
/**
 * Source per-row Debit increases the due to Supplier; Credit reduces due.
 * Each original Supplier remains an independent gross account, including
 * negative due (Supplier credit). Physical row order is APPEND provenance,
 * NOT chronological transaction-date display order.
 *
 * The returned candidate flag is only an internal structural check of the
 * supplied offline strings, never a verified source/D1/import status.
 */
export function auditHistoricalSupplierGrossLedger(input){
  if(!shape(input)||!literalID(input.shopId)||input.shopId.trim()!==input.shopId||
     !Array.isArray(input.suppliers)||!Array.isArray(input.supplierLedger)||
     input.suppliers.some(r=>!shape(r))||
     input.supplierLedger.some(r=>!shape(r)))
    throw genericError();

  const issues=new Map(),block=code=>nonnegativeCounter(issues,code);
  const suppliers=sourceRows(input.suppliers,'SUPPLIERS','Supplier ID','SUPPLIER',block);
  const ledger=sourceRows(input.supplierLedger,'SUPPLIER_LEDGER','Ledger ID','LEDGER',block);
  const perSupplier=new Map();
  for(const row of ledger.values()){
    const id=row['Supplier ID'];
    if(!suppliers.has(id)){
      block('LEDGER_SUPPLIER_MISSING');
      continue;
    }
    if(!perSupplier.has(id))perSupplier.set(id,[]);
    perSupplier.get(id).push(row);
  }
  let payables=0,credits=0;
  for(const [id,supplier] of suppliers){
    const opening=amount(supplier['Opening Balance'],false,block,'SUPPLIER_MONEY_EVIDENCE_UNSUPPORTED');
    const due=amount(supplier['Current Due'],false,block,'SUPPLIER_MONEY_EVIDENCE_UNSUPPORTED');
    if(due!==null){
      if(due>0n)payables++;
      if(due<0n)credits++;
    }
    const originalRows=(perSupplier.get(id)||[])
      .sort((a,b)=>a._rowIndex-b._rowIndex);
    if(!originalRows.length&&due!==null&&due!==0n)
      block('SUPPLIER_WITHOUT_LEDGER');

    let running=0n,openingLedger=0n,foundOpening=false,unusable=false;
    for(const row of originalRows){
      if(deleted(row)){
        block('DELETED_LEDGER_REQUIRES_REVIEW');
        unusable=true;
        continue;
      }
      if(!literalID(row.Type)){
        block('LEDGER_TYPE_REQUIRED');
        unusable=true;
        continue;
      }
      const isOpening=row.Type==='Opening Balance';
      if(isOpening){
        foundOpening=true;
        if(row.Reference!==id)
          block('OPENING_BALANCE_REFERENCE_MISMATCH');
      }
      const debit=amount(row.Debit,true,block,'LEDGER_MONEY_EVIDENCE_UNSUPPORTED');
      const credit=amount(row.Credit,true,block,'LEDGER_MONEY_EVIDENCE_UNSUPPORTED');
      const recorded=amount(row.Balance,false,block,'LEDGER_MONEY_EVIDENCE_UNSUPPORTED');
      if(debit===null||credit===null||recorded===null){
        unusable=true;continue;
      }
      if(debit<0n||credit<0n){
        block('NEGATIVE_LEDGER_SIDE');
        unusable=true;continue;
      }
      if(debit>0n&&credit>0n){
        block('DOUBLE_SIDED_LEDGER_ROW');
        unusable=true;continue;
      }
      const delta=debit-credit;
      const next=safeSum(running,delta,block);
      if(next===null){unusable=true;continue;}
      running=next;
      if(running!==recorded)block('LEDGER_RUNNING_BALANCE_MISMATCH');
      if(isOpening){
        const sum=safeSum(openingLedger,delta,block);
        if(sum===null){unusable=true;continue;}
        openingLedger=sum;
      }
    }
    if(opening!==null){
      if(!foundOpening&&opening!==0n)block('OPENING_LEDGER_UNVERIFIED');
      else if(foundOpening&&!unusable&&openingLedger!==opening)
        block('OPENING_BALANCE_MISMATCH');
    }
    if(!unusable&&due!==null&&running!==due)
      block('SUPPLIER_CURRENT_DUE_MISMATCH');
  }
  const blockers=[...issues].sort(([a],[b])=>a.localeCompare(b))
    .map(([code,count])=>({code,count}));
  return {
    candidateReady:blockers.length===0,
    counts:{
      suppliers:input.suppliers.length,
      ledgerRows:input.supplierLedger.length,
      payables,credits
    },
    blockers,
    historicalSourceVerified:false,
    d1Reconciled:false,
    postingAuthorized:false
  };
}
