/**
 * M10 Run 8 — read-only reconciliation of an existing synthetic M03 receipt.
 * No operational source access, D1 migration, posting, RPC, or cutover authority.
 */
const ERROR='M10 local purchase receipt audit unavailable';
const KEYS=['shopId','purchaseId','operationId','supplierId','partyId',
  'grandPaisa','paidPaisa','duePaisa','initialStock','lines','payments'];
const LIMIT=1001;
const blockers=Object.freeze([
  'HISTORICAL_SOURCE_PROVENANCE_NOT_VERIFIED',
  'M07_RETURN_REVERSAL_NOT_INTEGRATED',
  'OPERATIONAL_SHOP_POSTING_NOT_VERIFIED',
  'SOURCE_PURCHASE_AUTHORITY_NOT_VERIFIED'
]);
const sql=Object.freeze([
  "SELECT purchase_id AS purchaseId,operation_id AS operationId,supplier_id AS supplierId,party_id AS partyId,grand_paisa AS grandPaisa,paid_paisa AS paidPaisa,due_paisa AS duePaisa,expected_lines AS expectedLines,expected_payments AS expectedPayments FROM m03_fp_purchase WHERE shop_id=? AND purchase_id=? LIMIT ?",
  "SELECT line_id AS lineId,product_id AS productId,quantity,price_text AS priceText,unit_revision AS unitRevision,allocated_paisa AS allocatedPaisa FROM m03_fp_line WHERE shop_id=? AND purchase_id=? ORDER BY line_id LIMIT ?",
  "SELECT line_id AS lineId,product_id AS productId,quantity,allocated_cost_paisa AS allocatedPaisa FROM m03_fp_lot WHERE shop_id=? AND purchase_id=? ORDER BY line_id LIMIT ?",
  "SELECT leg_id AS legId,method,bank_account_id AS bankAccountId,applied_paisa AS appliedPaisa FROM m03_fp_payment WHERE shop_id=? AND purchase_id=? ORDER BY leg_id LIMIT ?",
  "SELECT leg_id AS legId,method,amount_paisa AS amountPaisa FROM m03_fp_money_book WHERE shop_id=? AND purchase_id=? ORDER BY leg_id LIMIT ?",
  "SELECT entry_type AS entryType,leg_id AS legId,debit_paisa AS debitPaisa,credit_paisa AS creditPaisa FROM m03_fp_supplier_ledger WHERE shop_id=? AND purchase_id=? ORDER BY entry_type,leg_id LIMIT ?",
  "SELECT line_count AS lineCount,payment_count AS paymentCount FROM m03_fp_seal WHERE shop_id=? AND purchase_id=? LIMIT ?",
  "SELECT product_id AS productId,quantity FROM m03_fp_stock WHERE shop_id=? ORDER BY product_id LIMIT ?",
  "SELECT supplier_id AS supplierId,party_id AS partyId,status,source_group AS sourceGroup,link_basis AS linkBasis FROM m03_fp_supplier WHERE shop_id=? AND supplier_id=? LIMIT ?"
]);
const scalar=x=>typeof x==='string'&&x.length>0&&x.length<=100&&
  !/[\u0000-\u001f\u007f]/u.test(x)&&x.trim()===x;
const cents=x=>Number.isSafeInteger(x)&&x>=0&&x<=100000000;
const qty=x=>Number.isSafeInteger(x)&&x>=0&&x<=1000000;
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  [Object.prototype,null].includes(Object.getPrototypeOf(x));
function shape(value,keys){
  if(!plain(value))throw new Error(ERROR);
  const found=Reflect.ownKeys(value);
  if(found.length!==keys.length||found.some(k=>typeof k!=='string'||!keys.includes(k)))throw new Error(ERROR);
  for(const key of keys){
    const d=Object.getOwnPropertyDescriptor(value,key);
    if(!d||!d.enumerable||!Object.hasOwn(d,'value'))throw new Error(ERROR);
  }
}
function records(items,keys,min=0,max=100){
  if(!Array.isArray(items)||items.length<min||items.length>max)throw new Error(ERROR);
  const ids=new Set();
  for(const row of items){
    shape(row,keys);
    const id=row[keys[0]];
    if(!scalar(id)||ids.has(id))throw new Error(ERROR);
    ids.add(id);
  }
}
function validate(expected){
  shape(expected,KEYS);
  for(const key of ['shopId','purchaseId','operationId','supplierId','partyId'])
    if(!scalar(expected[key]))throw new Error(ERROR);
  for(const key of ['grandPaisa','paidPaisa','duePaisa'])
    if(!cents(expected[key]))throw new Error(ERROR);
  records(expected.initialStock,['productId','quantity'],1);
  records(expected.lines,
    ['lineId','productId','quantity','unitRevision','priceText','allocatedPaisa'],1);
  records(expected.payments,
    ['legId','method','bankAccountId','appliedPaisa'],0,10);
  if(new Set(expected.initialStock.map(x=>x.productId)).size!==expected.initialStock.length)
    throw new Error(ERROR);
  const stocks=new Set(expected.initialStock.map(x=>x.productId));
  const products=new Set();
  let lineTotal=0,paymentTotal=0;
  for(const item of expected.initialStock)if(!qty(item.quantity))throw new Error(ERROR);
  for(const line of expected.lines){
    if(!scalar(line.productId)||!scalar(line.unitRevision)||
       typeof line.priceText!=='string'||
       !/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,3})?$/.test(line.priceText)||
       !qty(line.quantity)||line.quantity===0||
       !cents(line.allocatedPaisa)||
       !stocks.has(line.productId)||products.has(line.productId))
      throw new Error(ERROR);
    products.add(line.productId);
    lineTotal+=line.allocatedPaisa;
  }
  for(const payment of expected.payments){
    if(!['Cash','Bank'].includes(payment.method)||
       !cents(payment.appliedPaisa)||payment.appliedPaisa===0||
       (payment.method==='Cash'&&payment.bankAccountId!==null)||
       (payment.method==='Bank'&&!scalar(payment.bankAccountId)))
      throw new Error(ERROR);
    paymentTotal+=payment.appliedPaisa;
  }
  if(!Number.isSafeInteger(lineTotal)||!Number.isSafeInteger(paymentTotal)||
     lineTotal!==expected.grandPaisa||
     paymentTotal!==expected.paidPaisa||
     expected.grandPaisa!==expected.paidPaisa+expected.duePaisa)
    throw new Error(ERROR);
}
const rowKey=(x,key)=>x[key];
function compare(actual,expected,key,fields,category,add){
  const seen=new Map();
  for(const row of actual){
    if(!plain(row)||!scalar(row[key])){
      add(category+'_INVALID_ROW');
      continue;
    }
    const id=rowKey(row,key);
    if(seen.has(id)){add(category+'_DUPLICATE');continue;}
    seen.set(id,row);
  }
  const baseline=new Map(expected.map(x=>[rowKey(x,key),x]));
  for(const [id,reference] of baseline){
    const got=seen.get(id);
    if(!got){add(category+'_MISSING');continue;}
    if(fields.some(f=>got[f]!==reference[f]))add(category+'_MISMATCH');
  }
  for(const id of seen.keys())if(!baseline.has(id))add(category+'_EXTRA');
}
function single(actual,baseline,keys,missing,drift,add){
  if(actual.length===0){add(missing);return;}
  if(actual.length!==1){add(drift);return;}
  if(keys.some(k=>actual[0]?.[k]!==baseline[k]))add(drift);
}
function checkReadback(rows,expected,add){
  const [p,ls,lots,payments,money,ledger,seal,stocks,supplier]=rows;
  const header={
    purchaseId:expected.purchaseId,operationId:expected.operationId,
    supplierId:expected.supplierId,partyId:expected.partyId,
    grandPaisa:expected.grandPaisa,paidPaisa:expected.paidPaisa,
    duePaisa:expected.duePaisa,
    expectedLines:expected.lines.length,expectedPayments:expected.payments.length
  };
  single(p,header,Object.keys(header),'MISSING_PURCHASE','PURCHASE_IDENTITY_MISMATCH',add);
  compare(ls,expected.lines,'lineId',
    ['productId','quantity','unitRevision','priceText','allocatedPaisa'],'LINE',add);
  compare(lots,expected.lines.map(x=>({
    lineId:x.lineId,productId:x.productId,quantity:x.quantity,allocatedPaisa:x.allocatedPaisa
  })),'lineId',['productId','quantity','allocatedPaisa'],'LOT',add);
  compare(payments,expected.payments,'legId',
    ['method','bankAccountId','appliedPaisa'],'PAYMENT',add);
  compare(money,expected.payments.map(x=>({
    legId:x.legId,method:x.method,amountPaisa:x.appliedPaisa
  })),'legId',['method','amountPaisa'],'MONEY_BOOK',add);
  const expectedLedger=[
    {key:'Purchase|HEADER',entryType:'Purchase',legId:'HEADER',
      debitPaisa:expected.grandPaisa,creditPaisa:0},
    ...expected.payments.map(x=>({
      key:'Payment|'+x.legId,entryType:'Payment',legId:x.legId,
      debitPaisa:0,creditPaisa:x.appliedPaisa
    }))
  ];
  compare(ledger.map(x=>({...x,key:String(x.entryType)+'|'+String(x.legId)})),
    expectedLedger,'key',['entryType','legId','debitPaisa','creditPaisa'],
    'SUPPLIER_LEDGER',add);
  single(seal,{lineCount:expected.lines.length,paymentCount:expected.payments.length},
    ['lineCount','paymentCount'],'SEAL_MISSING','SEAL_MISMATCH',add);
  const increments=new Map();
  for(const line of expected.lines)
    increments.set(line.productId,(increments.get(line.productId)||0)+line.quantity);
  const expectedStock=expected.initialStock.map(x=>({
    productId:x.productId,quantity:x.quantity+(increments.get(x.productId)||0)
  }));
  compare(stocks,expectedStock,'productId',['quantity'],'STOCK_DELTA',add);
  single(supplier,{
    supplierId:expected.supplierId,partyId:expected.partyId,
    status:'Active',sourceGroup:'SUPPLIERS',linkBasis:'NEW_RECORD'
  },['supplierId','partyId','status','sourceGroup','linkBasis'],
    'SUPPLIER_LINK_MISSING','SUPPLIER_LINK_MISMATCH',add);
}
/**
 * Single bounded nine-query batch against a *disposable* M03 first-purchase
 * model. Synthetic conservation never implies live source/permission parity.
 */
export async function auditM10LocalPurchaseReceiptD1({DB,expected}={}){
  try{
    validate(expected); // Validate ALL supplied source expected data before D1.
    if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function')
      throw new Error(ERROR);
    const statements=sql.map((query,i)=>{
      const bindings=i===7
        ?[expected.shopId,LIMIT]
        :i===8
          ?[expected.shopId,expected.supplierId,2]
          :[expected.shopId,expected.purchaseId,i===0||i===6?2:LIMIT];
      return DB.prepare(query).bind(...bindings);
    });
    const packets=await DB.batch(statements);
    if(!Array.isArray(packets)||packets.length!==sql.length||
       packets.some(x=>!x||x.success!==true||!Array.isArray(x.results)||
         x.results.length>LIMIT))throw new Error(ERROR);
    const rows=packets.map(x=>x.results);
    const issues=new Map();
    const add=code=>issues.set(code,(issues.get(code)||0)+1);
    checkReadback(rows,expected,add);
    const ordered=[...issues].sort(([a],[b])=>a.localeCompare(b))
      .map(([code,count])=>({code,count}));
    const clear=prefixes=>!ordered.some(x=>prefixes.some(p=>x.code.startsWith(p)));
    const purchaseConserved=clear(['MISSING_PURCHASE','PURCHASE_','SEAL_']);
    const stockLotConserved=clear(['LINE_','LOT_','STOCK_']);
    const supplierLedgerConserved=clear(['SUPPLIER_']);
    const paymentBookConserved=clear(['PAYMENT_','MONEY_']);
    return {
      formatVersion:1,phase:'M10_SYNTHETIC_PURCHASE_RECEIPT_LOCAL_D1',
      expectedLines:expected.lines.length,observedLines:rows[1].length,
      purchaseConserved,stockLotConserved,supplierLedgerConserved,paymentBookConserved,
      syntheticReceiptConserved:ordered.length===0,
      sourcePurchasePermissionVerified:false,returnReversalIntegrated:false,
      realSourceReconciled:false,authorizesRealImport:false,
      authorizesRemoteD1Write:false,authorizesCutover:false,productionReady:false,
      issues:ordered,releaseBlockers:[...blockers],
      limitations:'Synthetic M03 purchase D1 only; frozen purchase.add authority, actual M07 returns and 49-group historical source reconciliation are not proven'
    };
  }catch{
    throw new Error(ERROR);
  }
}
