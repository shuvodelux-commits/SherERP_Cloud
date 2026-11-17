import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createM03AuthenticatedProductsBootstrap}
 from '../src/db/m03-authenticated-products-bootstrap.js';

const NOW=1_800_000_000_000;
const TOKEN='a'.repeat(64);
const denied=/M03 authenticated Products bootstrap rejected/;

test('M03 #621 RED: browser-supplied tenant, product, role or clock never becomes read authority',async()=>{
 const prepared=[];
 const fake={DB:{prepare(sql){prepared.push(sql);return {bind(){return {
  async all(){return {success:true,results:[]};}
 };}};}}};
 const reader=createM03AuthenticatedProductsBootstrap(fake,{now:()=>NOW});
 for(const payload of [
  {token:TOKEN,tenantId:'BUS-B'}, {token:TOKEN,productId:'PRD-000002'},
  {token:TOKEN,role:'Administrator'}, {token:TOKEN,nowMs:NOW},
  {token:TOKEN,productsView:true}, {},{token:'broken'}
 ]){
  await assert.rejects(()=>reader.getProductsBootstrap_(payload),denied);
 }
 assert.equal(prepared.length,0,'malformed/forged request must not reach D1');
});

test('M03 #621 RED: denied/revoked bearer cannot query Product, Unit, Tile or Stock rows',async()=>{
 const prepared=[];
 const fake={DB:{prepare(sql){prepared.push(sql);return {bind(){return {
  async all(){return {success:true,results:[]};}
 };}};}}};
 const reader=createM03AuthenticatedProductsBootstrap(fake,{now:()=>NOW});
 await assert.rejects(()=>reader.getProductsBootstrap_({token:TOKEN}),denied);
 assert.equal(prepared.length,1);
 assert.match(prepared[0],/auth_sessions/);
 assert.match(prepared[0],/products\.view/);
 assert.doesNotMatch(prepared[0],/FROM products\b|JOIN products\b|FROM product_units\b|FROM synthetic_m03_product_stock\b/);
});

test('M03 #621 RED: product integration is private SELECT-only and public RPC stays fail-closed',()=>{
 const product=readFileSync(new URL('../src/db/m03-authenticated-products-bootstrap.js',import.meta.url),'utf8');
 const rpc=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
 const worker=readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
 assert.doesNotMatch(product,/\b(?:INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|DROP\s+TABLE)\b/i);
 assert.match(rpc,/Object\.freeze\(Object\.create\(null\)\)/);
 assert.doesNotMatch(worker,/authenticated-products-bootstrap|m03-authenticated-products-bootstrap/);
});
