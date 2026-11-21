import test from 'node:test';
import assert from 'node:assert/strict';
import {COLUMN_DEFINITIONS,LOCKED_COLUMNS,readColumnVisibility,productStockGroup,filterProductsByStock} from '../../src/ui/hisabiq/product-table.mjs';
import {patchOwnerHisabiqProducts} from '../../scripts/patch-owner-hisabiq-products.mjs';

const list=[
  {'Product ID':'p1','Product Name':'In Stock','Current Stock':12,'Minimum Stock':5,Status:'Active'},
  {'Product ID':'p2','Product Name':'Low','Current Stock':2,'Minimum Stock':5,Status:'Active'},
  {'Product ID':'p3','Product Name':'Out','Current Stock':0,'Minimum Stock':5,Status:'Active'},
  {'Product ID':'p4','Product Name':'Disabled','Current Stock':0,'Minimum Stock':5,Status:'Inactive'},
  {'Product ID':'p5','Product Name':'Bundle','Product Type':'Bundle','Available Sets':3,Status:'Active'},
];

test('reference column order and essential visibility locks are exact',()=>{
 assert.deepEqual(COLUMN_DEFINITIONS.map(column=>column.id),['index','product','category','stock','stockValue','unit','purchase','selling','status']);
 assert.deepEqual(LOCKED_COLUMNS,['product','stock','selling']);
 assert.deepEqual(Object.values(readColumnVisibility(null)),Array(9).fill(true));
 const tampered=readColumnVisibility('{"product":false,"stock":false,"selling":false,"unit":false,"garbage":true}');
 assert.equal(tampered.product,true);assert.equal(tampered.stock,true);assert.equal(tampered.selling,true);
 assert.equal(tampered.unit,false);assert.equal('garbage' in tampered,false);
 assert.equal(readColumnVisibility('{not-json').product,true);
});

test('stock filters distinguish out/low and keep inactive rows on All',()=>{
 assert.equal(productStockGroup(list[0]),'in');
 assert.equal(productStockGroup(list[1]),'low');
 assert.equal(productStockGroup(list[2]),'out');
 assert.equal(productStockGroup(list[3]),'inactive');
 assert.equal(productStockGroup(list[4]),'in');
 assert.deepEqual(filterProductsByStock(list,'low').map(row=>row['Product ID']),['p2']);
 assert.deepEqual(filterProductsByStock(list,'out').map(row=>row['Product ID']),['p3']);
 assert.equal(filterProductsByStock(list,'all').length,5);
});

test('Owner-only UI injection is scoped, explicit and refuses double insertion',()=>{
 const html='<html><head></head><body><section id="page-products"><table id="prodTable"></table></section></body></html>';
 const result=patchOwnerHisabiqProducts(html,{css:'#page-products {}',js:'console.log("ui")'});
 assert.match(result,/data-hisabiq-design-system/);
 assert.match(result,/id="hisabiq-products-table-styles"/);
 assert.match(result,/id="hisabiq-products-table-controller"/);
 assert.throws(()=>patchOwnerHisabiqProducts(result,{css:'x',js:'x'}),/already installed/i);
 assert.throws(()=>patchOwnerHisabiqProducts('<html></html>',{css:'x',js:'x'}),/boundary/i);
});
