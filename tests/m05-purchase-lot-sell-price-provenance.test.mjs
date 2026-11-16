import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {auditPurchaseLotSellPriceProvenance} from
  '../src/modules/m05-purchase-lot-sell-price-provenance.js';

const header=(id='PUR-001',extra={})=>({
  'Purchase ID':id,'Supplier ID':'SUP-A','Is Deleted':'',...extra
});
const item=(id='PUR-001',product='P-A',sell=22,extra={})=>({
  'Purchase ID':id,'Product ID':product,'Quantity':5,
  'Sell Price':sell,...extra
});
const lot=(id='LOT-001',purchaseId='PUR-001',product='P-A',sell=22,extra={})=>({
  'Lot ID':id,'Purchase ID':purchaseId,'Product ID':product,
  'Original Quantity':5,'Remaining Quantity':3,'Sell Price':sell,
  'Status':'Active',...extra
});
const fixture=()=>({purchases:[header()],purchaseItems:[item()],stockLots:[lot()]});
const audit=s=>auditPurchaseLotSellPriceProvenance(s);
const codes=s=>audit(s).issues.map(x=>x.code);

test('frozen purchase create and edit write item and lot Sell Price from the same source price',()=>{
  const read=name=>readFileSync(new URL('../legacy/source/'+name,import.meta.url),'utf8');
  const create=read('Purchase.gs');
  const update=read('PurchaseManagement.gs');
  const stock=read('StockLots.gs');
  assert.match(create,/'Sell Price': line\.sellPrice/);
  assert.match(create,/createLot_\(line\.productId, line\.name, purchaseId, dateStr, line\.price, line\.qty, payload\.supplierId, supplierRow\['Supplier Name'\], line\.sellPrice\)/);
  assert.match(update,/'Sell Price': sellPrice/);
  assert.match(update,/lot\) updateRowFields_\('STOCK_LOTS', lot\._rowIndex, \{ 'Sell Price': sellPrice \}\)/);
  assert.match(stock,/'Sell Price': Number\(resolvedSellPrice\) \|\| 0/);
});

test('one active purchase and matching lot has no pricing discrepancy and no mutations',()=>{
  const data=fixture(),before=structuredClone(data);
  assert.deepEqual(audit(data),{
    ready:true,issues:[],summary:{
      purchases:1,activePurchases:1,deletedPurchases:0,
      purchaseItems:1,stockLots:1,comparedPrices:1,
      internalLots:0,retiredLots:0,priceTolerance:0.0000001
    }
  });
  assert.deepEqual(data,before);
});

test('different suppliers buying the same product retain independent purchase-lot prices',()=>{
  const data=fixture();
  data.purchases.push(header('PUR-002',{'Supplier ID':'SUP-B'}));
  data.purchaseItems.push(item('PUR-002','P-A',30));
  data.stockLots.push(lot('LOT-002','PUR-002','P-A',30));
  assert.equal(audit(data).ready,true);
  assert.equal(audit(data).summary.comparedPrices,2);
});

test('valid zero selling price is not treated as missing and fully consumed lots still compare',()=>{
  const data=fixture();
  data.purchaseItems[0]['Sell Price']=0;
  data.stockLots[0]['Sell Price']='0';
  data.stockLots[0]['Remaining Quantity']=0;
  data.stockLots[0].Status='Consumed';
  assert.equal(audit(data).ready,true);
});

test('lot source selling-price drift of a paisa is blocked; original floating epsilon accepted',()=>{
  const data=fixture();
  data.stockLots[0]['Sell Price']=22.01;
  assert.deepEqual(codes(data),['SELL_PRICE_MISMATCH']);
  data.stockLots[0]['Sell Price']=22.00000005;
  assert.equal(audit(data).ready,true);
});

test('changing latest product default does not rewrite purchase lot provenance',()=>{
  const data=fixture();
  const latestProductSellingPrice=99;
  assert.notEqual(latestProductSellingPrice,data.stockLots[0]['Sell Price']);
  assert.equal(audit(data).ready,true);
});

test('missing historical source price cells never silently fall back to a current Product price',()=>{
  const data=fixture();
  data.purchaseItems[0]['Sell Price']='';
  assert.ok(codes(data).includes('MISSING_ITEM_SELL_PRICE'));
  data.purchaseItems[0]['Sell Price']=22;
  data.stockLots[0]['Sell Price']=null;
  assert.ok(codes(data).includes('MISSING_LOT_SELL_PRICE'));
  data.stockLots[0]['Sell Price']=-5;
  assert.ok(codes(data).includes('INVALID_LOT_SELL_PRICE'));
  data.purchaseItems[0]['Sell Price']=Infinity;
  assert.ok(codes(data).includes('INVALID_ITEM_SELL_PRICE'));
});

test('duplicates of purchase IDs, item product pairs and purchase lots refuse arbitrary first match',()=>{
  const data=fixture();
  data.purchases.push(header());
  assert.ok(codes(data).includes('DUPLICATE_PURCHASE_ID'));
  data.purchases.pop();
  data.purchaseItems.push(item());
  assert.ok(codes(data).includes('DUPLICATE_PURCHASE_PRODUCT'));
  data.purchaseItems.pop();
  data.stockLots.push(lot('LOT-002'));
  assert.ok(codes(data).includes('AMBIGUOUS_PURCHASE_LOTS'));
});

test('source orphan purchase items, orphan purchase lots and missing item lot require review',()=>{
  const data=fixture();
  data.purchaseItems.push(item('UNKNOWN','P-X',9));
  assert.ok(codes(data).includes('ORPHAN_PURCHASE_ITEM'));
  data.purchaseItems.pop();
  data.stockLots.push(lot('LOT-ORPHAN','UNKNOWN','P-X',10));
  assert.ok(codes(data).includes('ORPHAN_PURCHASE_LOT'));
  data.stockLots=data.stockLots.filter(l=>l['Lot ID']!=='LOT-001');
  assert.ok(codes(data).includes('MISSING_PURCHASE_LOT'));
});

test('retired zero-quantity line lots and non-purchase OVERSOLD/OPENING lots are distinct',()=>{
  const data=fixture();
  data.stockLots.push(lot('LOT-RETIRED','PUR-001','P-REMOVED',12,{
    'Original Quantity':0,'Remaining Quantity':0,Status:'Consumed'
  }));
  data.stockLots.push(lot('LOT-OVER','OVERSOLD','P-A',0,{
    'Original Quantity':4,'Remaining Quantity':-4,Status:'Oversold'
  }));
  data.stockLots.push(lot('LOT-OPEN','OPENING-MIGRATION','P-A',0));
  const result=audit(data);
  assert.equal(result.ready,true);
  assert.equal(result.summary.retiredLots,1);
  assert.equal(result.summary.internalLots,2);
  data.stockLots[1]['Remaining Quantity']=1;
  assert.ok(codes(data).includes('LOT_WITHOUT_PURCHASE_ITEM'));
});

test('historical deleted purchase is kept but not assumed to be active pricing evidence',()=>{
  const data=fixture();
  data.purchases[0]['Is Deleted']='TRUE';
  data.stockLots[0].Status='Deleted';
  data.stockLots[0]['Remaining Quantity']=0;
  data.stockLots[0]['Sell Price']=55;
  const result=audit(data);
  assert.equal(result.ready,true);
  assert.equal(result.summary.deletedPurchases,1);
  assert.equal(result.summary.comparedPrices,0);
});

test('invalid original identity or missing lot ID blocks import-ready status',()=>{
  const data=fixture();
  data.purchases[0]['Purchase ID']=' ';
  assert.ok(codes(data).includes('INVALID_PURCHASE_ID'));
  data.purchases[0]['Purchase ID']='PUR-001';
  data.purchaseItems[0]['Product ID']='';
  assert.ok(codes(data).includes('INVALID_PURCHASE_ITEM_ID'));
  data.purchaseItems[0]['Product ID']='P-A';
  data.stockLots[0]['Lot ID']='';
  assert.ok(codes(data).includes('INVALID_STOCK_LOT_ID'));
});

test('empty dataset and missing/unsafe snapshots cannot report a false ready migration',()=>{
  assert.ok(codes({purchases:[],purchaseItems:[],stockLots:[]}).includes('EMPTY_PURCHASE_SNAPSHOT'));
  assert.throws(()=>audit(),/snapshot/i);
  assert.throws(()=>audit({purchases:[],purchaseItems:[],stockLots:null}),/snapshot/i);
  const data=fixture(),dirty=Object.defineProperty({},'Purchase ID',{
    get(){throw new Error('getter called');}
  });
  data.purchases.push(dirty);
  assert.throws(()=>audit(data),/accessor|snapshot/i);
});

test('pure audit is absent from public RPC, routes and database writers',()=>{
  const runtime=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/auditPurchaseLotSellPriceProvenance|m05-purchase-lot-sell-price-provenance/);
  assert.equal('operationId' in audit(fixture()),false);
});
