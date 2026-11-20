/**
 * M10 independent conservation readback for a clean Shop's operational
 * M03 credit Purchase -> one-lot Cash POS baseline.
 *
 * READ ONLY. Never posts or repairs records, authenticates an actor, or
 * authorizes backup/import/cutover. This intentionally does not reconcile
 * the still-unmerged native Return writer or historical source data.
 */
const ERROR='M10 operational Shop readback unavailable';
const LIMIT=1001;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const sql=Object.freeze([
  "SELECT shop_id AS shopId,database_id AS databaseId,database_marker AS marker FROM shop_identity WHERE singleton=1 LIMIT 1001",
  "SELECT product_id AS productId,quantity_micro AS qty FROM owner_mvp_product_stock ORDER BY product_id LIMIT 1001",
  "SELECT l.sequence AS id,l.product_id AS productId,l.purchase_sequence AS purchaseId,l.received_micro AS received,l.qty_micro AS remaining,pl.quantity_micro AS originalQty FROM owner_mvp_stock_lots l LEFT JOIN owner_mvp_purchase_lines pl ON pl.purchase_sequence=l.purchase_sequence AND pl.line_number=l.line_number ORDER BY l.sequence LIMIT 1001",
  "SELECT sequence AS id,lot_sequence AS lotId,product_id AS productId,cash_sequence AS cashId,quantity_micro AS qty,unit_price_paisa AS price,subtotal_paisa AS total FROM owner_mvp_sale_receipts ORDER BY sequence LIMIT 1001",
  "SELECT sale_sequence AS saleId,lot_sequence AS lotId,quantity_micro AS qty,unit_sell_paisa AS price,unit_cost_paisa AS cost FROM owner_mvp_sale_fifo_draws ORDER BY sale_sequence LIMIT 1001",
  "SELECT sale_sequence AS saleId,cash_sequence AS cashId,received_paisa AS amount FROM owner_mvp_sale_cash_book ORDER BY sale_sequence LIMIT 1001",
  "SELECT p.sequence AS purchaseId,p.supplier_id AS supplierId,p.subtotal_paisa AS total,l.debit_paisa AS dueDebit,l.supplier_id AS ledgerSupplier FROM owner_mvp_purchase_receipts p LEFT JOIN owner_mvp_supplier_ledger l ON l.purchase_sequence=p.sequence ORDER BY p.sequence LIMIT 1001",
  "SELECT supplier_id AS supplierId,current_due_paisa AS due FROM owner_supplier_master ORDER BY supplier_id LIMIT 1001",
  "SELECT sequence AS id,status,opening_paisa AS opening FROM owner_mvp_cash_sessions ORDER BY sequence LIMIT 1001",
  "SELECT purchase_sequence AS purchaseId,SUM(line_total_paisa) AS total,COUNT(*) AS lineCount FROM owner_mvp_purchase_lines GROUP BY purchase_sequence ORDER BY purchase_sequence LIMIT 1001"
]);
const integer=x=>Number.isSafeInteger(x)&&x>=0;
const positive=x=>integer(x)&&x>0;
const validId=x=>(typeof x==='string'&&x.length>0&&x.length<=180)||
  (Number.isSafeInteger(x)&&x>0);
function index(rows,key,tag,add){
  const out=new Map();
  for(const row of rows){
    const id=row?.[key];
    if(!validId(id)||out.has(id)){add(tag+'_DUPLICATE_OR_INVALID');continue;}
    out.set(id,row);
  }
  return out;
}
function checkRows(rows,scope,add){
  const [identity,stockRows,lotRows,saleRows,drawRows,cashRows,
    purchaseRows,supplierRows,sessionRows,purchaseLineRows]=rows;
  if(identity.length!==1||
     identity[0]?.shopId!==scope.shopId||
     identity[0]?.databaseId!==scope.databaseId||
     identity[0]?.marker!==scope.marker)
    add('SHOP_BINDING_MISMATCH');
  const stocks=index(stockRows,'productId','STOCK',add);
  const lots=index(lotRows,'id','LOT',add);
  const sales=index(saleRows,'id','SALE',add);
  const draws=index(drawRows,'saleId','DRAW',add);
  const cash=index(cashRows,'saleId','CASH',add);
  const purchases=index(purchaseRows,'purchaseId','PURCHASE',add);
  const suppliers=index(supplierRows,'supplierId','SUPPLIER',add);
  const sessions=index(sessionRows,'id','SESSION',add);
  const lines=index(purchaseLineRows,'purchaseId','LINE',add);
  if(!saleRows.length)add('NO_SALE_RECEIPT');
  if(!purchaseRows.length)add('NO_PURCHASE_RECEIPT');

  const drawnByLot=new Map();
  for(const d of drawRows){
    const r=sales.get(d.saleId);
    if(!r||r.lotId!==d.lotId||r.qty!==d.qty||r.price!==d.price||
       !integer(d.cost))add('SALE_DRAW_MISMATCH');
    if(!positive(d.qty))add('SALE_DRAW_MISMATCH');
    const prior=drawnByLot.get(d.lotId)||0;
    if(!Number.isSafeInteger(prior+d.qty))add('SALE_DRAW_MISMATCH');
    else drawnByLot.set(d.lotId,prior+d.qty);
  }
  for(const r of saleRows){
    if(!draws.has(r.id))add('SALE_DRAW_MISMATCH');
    const b=cash.get(r.id);
    if(!b||b.cashId!==r.cashId||b.amount!==r.total||
       !positive(r.total)||!positive(r.price)||!positive(r.qty)||
       r.qty%1000000!==0||r.total!==(r.qty/1000000)*r.price)
      add('SALE_CASH_MISMATCH');
    if(!sessions.has(r.cashId))add('SALE_SESSION_MISMATCH');
    const l=lots.get(r.lotId);
    if(!l||l.productId!==r.productId)add('SALE_LOT_MISMATCH');
  }
  for(const b of cashRows){
    if(!sales.has(b.saleId)||!sessions.has(b.cashId))
      add('SALE_CASH_MISMATCH');
  }
  const remainingByProduct=new Map();
  for(const l of lotRows){
    const drawn=drawnByLot.get(l.id)||0;
    if(!positive(l.received)||!integer(l.remaining)||
       l.originalQty!==l.received||
       !integer(drawn)||l.received-drawn!==l.remaining)
      add('LOT_DRAW_MISMATCH');
    remainingByProduct.set(l.productId,
      (remainingByProduct.get(l.productId)||0)+l.remaining);
  }
  for(const lotId of drawnByLot.keys())
    if(!lots.has(lotId))add('SALE_LOT_MISMATCH');
  for(const [productId,expectedQty] of remainingByProduct){
    if(!Number.isSafeInteger(expectedQty)||
       stocks.get(productId)?.qty!==expectedQty)
      add('STOCK_LOT_MISMATCH');
  }
  for(const r of stockRows){
    if(!integer(r.qty)||!remainingByProduct.has(r.productId))
      add('STOCK_LOT_MISMATCH');
  }

  const dueBySupplier=new Map();
  for(const r of purchaseRows){
    if(!positive(r.total)||r.dueDebit!==r.total||
       r.ledgerSupplier!==r.supplierId)
      add('PURCHASE_LEDGER_MISMATCH');
    const line=lines.get(r.purchaseId);
    if(!line||line.total!==r.total||!positive(line.lineCount))
      add('PURCHASE_LINE_MISMATCH');
    const prior=dueBySupplier.get(r.supplierId)||0;
    if(!Number.isSafeInteger(prior+r.total))add('SUPPLIER_DUE_MISMATCH');
    else dueBySupplier.set(r.supplierId,prior+r.total);
  }
  for(const line of purchaseLineRows)
    if(!purchases.has(line.purchaseId))add('PURCHASE_LINE_MISMATCH');
  for(const [supplierId,due] of dueBySupplier){
    if(suppliers.get(supplierId)?.due!==due)add('SUPPLIER_DUE_MISMATCH');
  }
  for(const supplier of supplierRows)
    if(!integer(supplier.due)||
       supplier.due!==(dueBySupplier.get(supplier.supplierId)||0))
      add('SUPPLIER_DUE_MISMATCH');
  for(const s of sessionRows){
    if(!['Open','Closed'].includes(s.status)||s.opening!==0)
      add('SESSION_BALANCE_MISMATCH');
  }
}
/**
 * Caller must already have selected the verified PRIVATE physical Shop D1.
 * A matching Shop identity is necessary, not sufficient, for any authorization.
 * Returns fixed codes + counts only, never source IDs, customer info or values.
 */
export async function auditM10OperationalOwnerSaleD1({DB,shopId,databaseId,marker}={}){
  try{
    if(!DB||typeof DB.prepare!=='function'||typeof DB.batch!=='function'||
       ![shopId,databaseId,marker].every(v=>UUID.test(v)))
      throw new Error(ERROR);
    const queries=sql.map(s=>DB.prepare(s));
    const packets=await DB.batch(queries);
    if(!Array.isArray(packets)||packets.length!==sql.length||
       packets.some(x=>!x||x.success!==true||!Array.isArray(x.results)||
         x.results.length>LIMIT))throw new Error(ERROR);
    const rows=packets.map(x=>x.results);
    const issues=new Map();
    const add=code=>issues.set(code,(issues.get(code)||0)+1);
    if(rows.some(x=>x.length>=LIMIT))add('ROW_LIMIT_REACHED');
    checkRows(rows,{shopId,databaseId,marker},add);
    const reported=[...issues].sort(([a],[b])=>a.localeCompare(b))
      .map(([code,count])=>Object.freeze({code,count}));
    return Object.freeze({
      phase:'M10_LOCAL_OPERATIONAL_CASH_SALE_CONSERVATION',
      invoicesChecked:rows[3].length,
      lotsChecked:rows[2].length,
      operationalSaleConserved:reported.length===0,
      issues:Object.freeze(reported),
      returnReversalIntegrated:false,
      historicalSourceReconciled:false,
      productionReady:false,
      authorizesRemoteD1Write:false,
      authorizesCutover:false,
      limitations:'Disposable local real Shop D1 cash Sale only; does not cover native Returns, real 49-group source import, approved backup/restore or hosted cutover'
    });
  }catch{
    throw new Error(ERROR);
  }
}
