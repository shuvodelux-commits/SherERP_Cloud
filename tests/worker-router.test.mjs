import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

const req = (path, options = {}) => new Request('https://preview.example' + path, options);

test('health probe is explicit, unauthenticated, and never claims DB readiness', async () => {
  const res = await worker.fetch(req('/api/health'), {});
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), {status: 'foundation', service: 'shererp-cloud', database: 'not-connected'});
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const post = await worker.fetch(req('/api/health', {method: 'POST'}), {});
  assert.equal(post.status, 405);
});

test('unknown API paths are not served by the frontend SPA fallback', async () => {
  const res = await worker.fetch(req('/api/not-a-page'), {ASSETS:{fetch(){throw Error('asset must not be called')}}});
  assert.equal(res.status,404);
  assert.equal((await res.json()).success,false);
  const noSlash=await worker.fetch(req('/api'), {});
  assert.equal(noSlash.status,404);
});

test('ordinary paths are delegated unchanged to the static asset binding', async () => {
  let seen;
  const request=req('/products?mode=quick');
  const response=await worker.fetch(request,{ASSETS:{fetch(r){seen=r;return new Response('original UI', {status:200})}}});
  assert.equal(seen,request);
  assert.equal(await response.text(),'original UI');
});

test('without the assets binding the Worker explicitly fails instead of inventing a UI',async () => {
  const r=await worker.fetch(req('/'), {});
  assert.equal(r.status,503);
});

test('RPC endpoint is fail closed before authentication and business handlers are migrated', async () => {
  const res=await worker.fetch(req('/api/rpc',{method:'POST',headers:{'Content-Type':'application/json','Origin':'https://preview.example'},body:JSON.stringify({fnName:'completeSale',args:['unsafe-token',{}]})}),{});
  assert.equal(res.status,501);
  assert.deepEqual(await res.json(),{success:false,message:'RPC method not migrated'});
});

test('RPC rejects wrong method, origin, content-type, invalid payload and oversized body',async()=>{
  const call=(options)=>worker.fetch(req('/api/rpc',options),{});
  assert.equal((await call({method:'GET'})).status,405);
  assert.equal((await call({method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'})).status,403);
  assert.equal((await call({method:'POST',headers:{'Content-Type':'text/plain'},body:'{}'})).status,415);
  assert.equal((await call({method:'POST',headers:{'Content-Type':'application/json'},body:'nope'})).status,400);
  assert.equal((await call({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fnName:'../../file',args:[]})})).status,400);
  assert.equal((await call({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({fnName:'login',args:{}})})).status,400);
  assert.equal((await call({method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(65537)})).status,413);
});
