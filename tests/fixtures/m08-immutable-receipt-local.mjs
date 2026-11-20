/**
 * ISOLATED M08 RUN 5 REAL LOCAL WORKERD D1 TEST FIXTURE.
 * This is deliberately NOT an ERP migration, financial writer or auth layer.
 * Test-only tables enforce quote/line/payment/return integer conservation.
 * All candidate monetary values must be independently approved in M08 #66
 * before any operational SQL design; M03/M04 hold the shared writer authority.
 */
import {createHash} from 'node:crypto';
import {allocateInvoicePaisa} from '../../src/modules/m08-exact-decimal-proposal.js';
import {normalizeSalePayments_,salePaymentPaisa_} from '../../src/modules/sale-payments.js';

const MAX_SYNTHETIC=1000000000n;
const canonicalMinor=value=>{
  if(typeof value!=='string'||!/^(?:0|[1-9][0-9]{0,9})$/u.test(value))
    throw new TypeError('Canonical nonnegative synthetic integer-paisa amount required');
  const n=BigInt(value);
  if(n>MAX_SYNTHETIC)throw new RangeError('Synthetic receipt amount is out of range');
  return Number(n);
};
const id=value=>{
  if(typeof value!=='string'||!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,63}$/u.test(value))
    throw new TypeError('Stable synthetic receipt ID required');
  return value;
};
const bankAccounts=[{
  'Bank Account ID':'BANK-A','Account Name':'Synthetic Bank',
  'Account Type':'Bank',Status:'Active','Is Deleted':'FALSE'
}];
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const first=async(DB,sql,...args)=>DB.prepare(sql).bind(...args).first();
const all=async(DB,sql,...args)=>(await DB.prepare(sql).bind(...args).all()).results;
const DDL=[
  `CREATE TABLE m08_r5_headers(
    shop_id TEXT NOT NULL, invoice_id TEXT NOT NULL, operation_id TEXT NOT NULL,
    intent_hash TEXT NOT NULL, rounding_mode TEXT NOT NULL,
    grand_paisa INTEGER NOT NULL CHECK(grand_paisa BETWEEN 0 AND 1000000000),
    due_paisa INTEGER NOT NULL CHECK(due_paisa BETWEEN 0 AND 1000000000),
    PRIMARY KEY(shop_id, invoice_id), UNIQUE(shop_id, operation_id)
  )`,
  `CREATE TABLE m08_r5_lines(
    shop_id TEXT NOT NULL, invoice_id TEXT NOT NULL, line_id TEXT NOT NULL,
    raw_qty TEXT NOT NULL, raw_unit_price TEXT NOT NULL,
    net_paisa INTEGER NOT NULL CHECK(net_paisa BETWEEN 0 AND 1000000000),
    PRIMARY KEY(shop_id,invoice_id,line_id),
    FOREIGN KEY(shop_id,invoice_id) REFERENCES m08_r5_headers(shop_id,invoice_id)
  )`,
  `CREATE TABLE m08_r5_payments(
    shop_id TEXT NOT NULL,invoice_id TEXT NOT NULL,leg_id TEXT NOT NULL,
    method TEXT NOT NULL CHECK(method IN ('Cash','Bank','Mobile Banking')),
    applied_paisa INTEGER NOT NULL CHECK(applied_paisa BETWEEN 0 AND 1000000000),
    change_paisa INTEGER NOT NULL CHECK(change_paisa BETWEEN 0 AND 1000000000),
    PRIMARY KEY(shop_id,invoice_id,leg_id),
    FOREIGN KEY(shop_id,invoice_id) REFERENCES m08_r5_headers(shop_id,invoice_id)
  )`,
  `CREATE TABLE m08_r5_seals(
    shop_id TEXT NOT NULL,invoice_id TEXT NOT NULL,
    line_count INTEGER NOT NULL CHECK(line_count BETWEEN 1 AND 200),
    payment_count INTEGER NOT NULL CHECK(payment_count BETWEEN 0 AND 20),
    PRIMARY KEY(shop_id,invoice_id),
    FOREIGN KEY(shop_id,invoice_id) REFERENCES m08_r5_headers(shop_id,invoice_id)
  )`,
  `CREATE TRIGGER m08_r5_seal_conservation BEFORE INSERT ON m08_r5_seals
  BEGIN
    SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM m08_r5_headers h
        WHERE h.shop_id=NEW.shop_id AND h.invoice_id=NEW.invoice_id)
      OR (SELECT COUNT(*) FROM m08_r5_lines
        WHERE shop_id=NEW.shop_id AND invoice_id=NEW.invoice_id)<>NEW.line_count
      OR (SELECT COUNT(*) FROM m08_r5_payments
        WHERE shop_id=NEW.shop_id AND invoice_id=NEW.invoice_id)<>NEW.payment_count
      OR (SELECT COALESCE(SUM(net_paisa),0) FROM m08_r5_lines
        WHERE shop_id=NEW.shop_id AND invoice_id=NEW.invoice_id)
        <>(SELECT grand_paisa FROM m08_r5_headers
        WHERE shop_id=NEW.shop_id AND invoice_id=NEW.invoice_id)
      OR (SELECT COALESCE(SUM(applied_paisa),0) FROM m08_r5_payments
        WHERE shop_id=NEW.shop_id AND invoice_id=NEW.invoice_id)
        +(SELECT due_paisa FROM m08_r5_headers
        WHERE shop_id=NEW.shop_id AND invoice_id=NEW.invoice_id)
        <>(SELECT grand_paisa FROM m08_r5_headers
        WHERE shop_id=NEW.shop_id AND invoice_id=NEW.invoice_id)
      THEN RAISE(ABORT,'M08_R5_CONSERVATION_FAILED') END;
  END`,
  `CREATE TABLE m08_r5_returns(
    shop_id TEXT NOT NULL,invoice_id TEXT NOT NULL,return_id TEXT NOT NULL,
    line_id TEXT NOT NULL,returned_paisa INTEGER NOT NULL
      CHECK(returned_paisa BETWEEN 1 AND 1000000000),
    cash_refund_paisa INTEGER NOT NULL
      CHECK(cash_refund_paisa BETWEEN 0 AND 1000000000),
    noncash_paisa INTEGER NOT NULL
      CHECK(noncash_paisa BETWEEN 0 AND 1000000000),
    PRIMARY KEY(shop_id,invoice_id,return_id),
    FOREIGN KEY(shop_id,invoice_id,line_id)
      REFERENCES m08_r5_lines(shop_id,invoice_id,line_id)
  )`,
  `CREATE TRIGGER m08_r5_return_guard BEFORE INSERT ON m08_r5_returns
  BEGIN
    SELECT CASE WHEN NOT EXISTS(
      SELECT 1 FROM m08_r5_seals WHERE shop_id=NEW.shop_id
        AND invoice_id=NEW.invoice_id)
      THEN RAISE(ABORT,'M08_R5_UNSEALED') END;
    SELECT CASE WHEN NOT EXISTS(
      SELECT 1 FROM m08_r5_lines WHERE shop_id=NEW.shop_id
        AND invoice_id=NEW.invoice_id AND line_id=NEW.line_id)
      THEN RAISE(ABORT,'M08_R5_REFERENCED_LINE') END;
    SELECT CASE WHEN NEW.returned_paisa
        +(SELECT COALESCE(SUM(returned_paisa),0) FROM m08_r5_returns
        WHERE shop_id=NEW.shop_id AND invoice_id=NEW.invoice_id
          AND line_id=NEW.line_id)
       >(SELECT net_paisa FROM m08_r5_lines
         WHERE shop_id=NEW.shop_id AND invoice_id=NEW.invoice_id
           AND line_id=NEW.line_id)
      THEN RAISE(ABORT,'M08_R5_OVER_RETURN') END;
    SELECT CASE WHEN NEW.returned_paisa<>
         NEW.cash_refund_paisa+NEW.noncash_paisa
      THEN RAISE(ABORT,'M08_R5_RETURN_SPLIT') END;
    SELECT CASE WHEN NEW.cash_refund_paisa
        +(SELECT COALESCE(SUM(cash_refund_paisa),0) FROM m08_r5_returns
        WHERE shop_id=NEW.shop_id AND invoice_id=NEW.invoice_id)
       >(SELECT COALESCE(SUM(applied_paisa),0) FROM m08_r5_payments
        WHERE shop_id=NEW.shop_id AND invoice_id=NEW.invoice_id)
      THEN RAISE(ABORT,'M08_R5_REFUND_BACKING') END;
  END`
];
export async function initSyntheticReceiptDb(DB){
  for(const name of ['m08_r5_returns','m08_r5_seals','m08_r5_payments',
    'm08_r5_lines','m08_r5_headers']){
    await DB.prepare('DROP TABLE IF EXISTS '+name).run();
  }
  for(const sql of DDL)await DB.prepare(sql).run();
  // Fixed test-only identifiers; these are never constructed from user input.
  const immutableTables=['m08_r5_headers','m08_r5_lines','m08_r5_payments',
    'm08_r5_seals','m08_r5_returns'];
  for(const table of immutableTables){
    for(const operation of ['UPDATE','DELETE']){
      await DB.prepare(
        `CREATE TRIGGER ${table}_no_${operation.toLowerCase()}
        BEFORE ${operation} ON ${table}
        BEGIN SELECT RAISE(ABORT,'M08_R5_IMMUTABLE'); END`
      ).run();
    }
  }
  // The seal is the only moment where header/line/tender totals can close.
  // A post-seal extra insert would otherwise corrupt that proven equality.
  for(const table of ['m08_r5_lines','m08_r5_payments']){
    await DB.prepare(
      `CREATE TRIGGER ${table}_sealed
       BEFORE INSERT ON ${table}
       BEGIN SELECT CASE WHEN EXISTS(
         SELECT 1 FROM m08_r5_seals
         WHERE shop_id=NEW.shop_id AND invoice_id=NEW.invoice_id
       ) THEN RAISE(ABORT,'M08_R5_SEALED') END; END`
    ).run();
  }
}
/** Quote only. HALF_UP is explicitly passed by tests, not selected by project policy. */
export function quoteSyntheticInvoice({lines,discount,roundingMode}){
  return allocateInvoicePaisa({lines,discount,roundingMode});
}
async function existingForOp(DB,shop,op){
  return first(DB,
    'SELECT invoice_id,intent_hash,grand_paisa FROM m08_r5_headers WHERE shop_id=? AND operation_id=?',
    shop,op);
}
export async function submitSyntheticReceipt(DB,input){
  const {
    shopId,invoiceId,operationId,lines,discount,roundingMode,payments,
    testOnlyInjectedLineDeltaPaisa=0,testOnlyInjectedPaymentDeltaPaisa=0
  }=input;
  const shop=id(shopId),invoice=id(invoiceId),operation=id(operationId);
  if(!Array.isArray(lines)||!Array.isArray(payments))
    throw new TypeError('Synthetic line and tender arrays required');
  const quote=quoteSyntheticInvoice({lines,discount,roundingMode});
  const grand=canonicalMinor(quote.grandPaisa);
  const split=normalizeSalePayments_(grand/100,payments,bankAccounts);
  const applied=split.payments.map(x=>({
    id:id(x.rowId),method:x.method,
    amount:canonicalMinor(String(salePaymentPaisa_(x.applied,'Applied',false))),
    change:canonicalMinor(String(salePaymentPaisa_(x.change,'Change',false)))
  }));
  const due=canonicalMinor(String(salePaymentPaisa_(split.dueAmount,'Due',false)));
  const intentHash=hash({shop,invoice,operation,lines,discount,roundingMode,payments});
  const present=await existingForOp(DB,shop,operation);
  if(present){
    if(present.intent_hash!==intentHash||present.invoice_id!==invoice)
      throw new Error('Operation ID already used with changed intent');
    return {state:'replay',grandPaisa:String(present.grand_paisa)};
  }
  const statements=[
    DB.prepare('INSERT INTO m08_r5_headers VALUES(?,?,?,?,?,?,?)')
      .bind(shop,invoice,operation,intentHash,roundingMode,grand,due),
    ...quote.lines.map((line,i)=>DB.prepare(
      'INSERT INTO m08_r5_lines VALUES(?,?,?,?,?,?)'
    ).bind(shop,invoice,id(line.id),line.quantitySource,line.unitPriceSource,
      canonicalMinor(line.netPaisa)+(i===0?testOnlyInjectedLineDeltaPaisa:0))),
    ...applied.map((p,i)=>DB.prepare(
      'INSERT INTO m08_r5_payments VALUES(?,?,?,?,?,?)'
    ).bind(shop,invoice,p.id,p.method,
      p.amount+(i===0?testOnlyInjectedPaymentDeltaPaisa:0),p.change)),
    DB.prepare('INSERT INTO m08_r5_seals VALUES(?,?,?,?)')
      .bind(shop,invoice,quote.lines.length,applied.length)
  ];
  try{
    await DB.batch(statements);
  }catch(error){
    // Competing identical operation may have committed while our batch waited.
    const winner=await existingForOp(DB,shop,operation);
    if(winner&&winner.intent_hash===intentHash&&winner.invoice_id===invoice)
      return {state:'replay',grandPaisa:String(winner.grand_paisa)};
    throw error;
  }
  return {state:'inserted',grandPaisa:String(grand)};
}
export async function recordSyntheticReturn(DB,input){
  const {shopId,invoiceId,returnId,lineId,returnedPaisa,cashRefundPaisa}=input;
  const shop=id(shopId),invoice=id(invoiceId),returnKey=id(returnId),line=id(lineId);
  const returned=canonicalMinor(returnedPaisa),cash=canonicalMinor(cashRefundPaisa);
  if(returned===0||cash>returned)
    throw new RangeError('Synthetic return amount must be positive and cash cannot exceed it');
  const existing=await first(DB,
    'SELECT line_id,returned_paisa,cash_refund_paisa FROM m08_r5_returns WHERE shop_id=? AND invoice_id=? AND return_id=?',
    shop,invoice,returnKey);
  if(existing){
    if(existing.line_id!==line||existing.returned_paisa!==returned||
        existing.cash_refund_paisa!==cash)
      throw new Error('Return ID already used with changed intent');
    return {state:'replay'};
  }
  try{
    await DB.prepare('INSERT INTO m08_r5_returns VALUES(?,?,?,?,?,?,?)')
      .bind(shop,invoice,returnKey,line,returned,cash,returned-cash).run();
  }catch(error){
    const winner=await first(DB,
      'SELECT line_id,returned_paisa,cash_refund_paisa FROM m08_r5_returns WHERE shop_id=? AND invoice_id=? AND return_id=?',
      shop,invoice,returnKey);
    if(winner&&winner.line_id===line&&winner.returned_paisa===returned&&
      winner.cash_refund_paisa===cash)return {state:'replay'};
    throw error;
  }
  return {state:'inserted'};
}
export async function receiptSnapshot(DB,shopId,invoiceId){
  const shop=id(shopId),invoice=id(invoiceId);
  const header=await first(DB,
    'SELECT * FROM m08_r5_headers WHERE shop_id=? AND invoice_id=?',shop,invoice);
  const lines=await all(DB,
    'SELECT * FROM m08_r5_lines WHERE shop_id=? AND invoice_id=? ORDER BY line_id',shop,invoice);
  const payments=await all(DB,
    'SELECT * FROM m08_r5_payments WHERE shop_id=? AND invoice_id=? ORDER BY leg_id',shop,invoice);
  const seal=await first(DB,
    'SELECT * FROM m08_r5_seals WHERE shop_id=? AND invoice_id=?',shop,invoice);
  const returns=await all(DB,
    'SELECT * FROM m08_r5_returns WHERE shop_id=? AND invoice_id=? ORDER BY return_id',shop,invoice);
  return {header,lines,payments,seal,returns};
}
