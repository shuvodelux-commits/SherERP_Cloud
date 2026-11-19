import {getCookie,setCookie} from 'hono/cookie';
import {Hono} from 'hono';
import {signOutOwnerBrowser,validateOwnerSession} from '../../src/auth/platform-owner-sessions.js';
import {hashOpaqueSessionToken} from '../../src/auth/session-token.js';

// Local test fixture only. Neither the route nor its synthetic shop selection
// is a deployed write authority. The local grant tests the SQL boundary.
// It does not synchronize real Control D1 session issuance or revocation.
const app=new Hono();
const PRODUCT_FIELDS=`product_id AS id, product_name AS name, base_unit_name AS unit,
  purchase_price_text AS purchasePrice, selling_price_text AS sellingPrice, opening_stock_text AS stock`;
const OPERATIONS=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const PRICE=/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/;
const CAN_WRITE='EXISTS(SELECT 1 FROM fixture_owner_write_grants WHERE token_hash=? AND enabled=1)';

app.use('/__clean_shop__/*',async(c,next)=>{
  if(c.env.CLEAN_SHOP_FIXTURE!=='true')return c.notFound();
  const origin=new URL(c.req.url).origin;
  const target=origin==='https://a.example.test'?'A':origin==='https://b.example.test'?'B':null;
  if(!target)return c.notFound();
  if(c.req.method==='POST'&&c.req.header('Origin')!==origin)return c.json({error:'Origin denied'},403);
  const db=target==='A'?c.env.SHOP_A_DB:c.env.SHOP_B_DB;
  const {shopId,databaseId,marker}=JSON.parse(target==='A'?c.env.SHOP_A:c.env.SHOP_B);
  const token=getCookie(c,'__Host-shererp-owner-session');
  const env={
    CONTROL_DB:c.env.CONTROL_DB,PLATFORM_PILOT_DB:db,PLATFORM_PILOT_SHOP_ID:shopId,
    PLATFORM_PILOT_D1_ID:databaseId,PLATFORM_PILOT_MARKER:marker,
  };
  const session=await validateOwnerSession(env,token);
  if(!session)return c.json({error:'Owner session required'},401);
  c.set('shopDb',db);
  c.set('ownerEnv',env);
  c.set('sessionToken',token);
  if(c.req.method==='POST')c.set('writeTokenHash',await hashOpaqueSessionToken(token));
  c.header('Cache-Control','no-store');
  await next();
});

app.post('/__clean_shop__/logout',async c=>{
  try{
    const result=await c.get('shopDb').prepare(
      'UPDATE fixture_owner_write_grants SET enabled=0 WHERE token_hash=?',
    ).bind(c.get('writeTokenHash')).run();
    if(result.success!==true)return c.json({error:'Sign-out incomplete'},503);
    if(!await signOutOwnerBrowser(c.get('ownerEnv'),{sessionToken:c.get('sessionToken')})){
      return c.json({error:'Sign-out incomplete'},503);
    }
    setCookie(c,'__Host-shererp-owner-session','',{path:'/',secure:true,httpOnly:true,sameSite:'Strict',maxAge:0});
    return c.json({signedOut:true});
  }catch{
    return c.json({error:'Sign-out incomplete'},503);
  }
});

app.get('/__clean_shop__/products',async c=>{
  const db=c.get('shopDb');
  const result=await db.prepare(`SELECT ${PRODUCT_FIELDS} FROM products WHERE is_deleted=0 ORDER BY product_id LIMIT 100`).all();
  return c.json({data:result.results});
});

app.post('/__clean_shop__/products',async c=>{
  const draft=await c.req.json().catch(()=>null);
  const fields=['operationId','name','unit','purchasePrice','sellingPrice'];
  if(!draft||Object.keys(draft).length!==fields.length||!fields.every(k=>typeof draft[k]==='string')){
    return c.json({error:'Invalid product'},400);
  }
  const {operationId,purchasePrice,sellingPrice}=draft;
  const name=draft.name.trim(),unit=draft.unit.trim();
  if(!OPERATIONS.test(operationId)||!name||name.length>120||!unit||unit.length>32||
    !PRICE.test(purchasePrice)||!PRICE.test(sellingPrice))return c.json({error:'Invalid product'},400);
  const db=c.get('shopDb');
  const id=`fixture-${operationId}`;
  const tokenHash=c.get('writeTokenHash');
  const created=await db.prepare(`INSERT INTO products
    (product_id,source_profile,product_name,base_unit_name,purchase_price_text,selling_price_text,opening_stock_text)
    SELECT ?,'new',?,?,?,?,'0'
    WHERE ${CAN_WRITE} AND NOT EXISTS(SELECT 1 FROM products WHERE is_deleted=0 AND lower(product_name)=lower(?))
    ON CONFLICT(product_id) DO NOTHING RETURNING ${PRODUCT_FIELDS}`).bind(id,name,unit,purchasePrice,sellingPrice,tokenHash,name).first();
  if(created)return c.json({data:created},201);
  const saved=await db.prepare(`SELECT ${PRODUCT_FIELDS} FROM products WHERE product_id=? AND is_deleted=0 AND ${CAN_WRITE}`).bind(id,tokenHash).first();
  if(saved?.name===name&&saved.unit===unit&&saved.purchasePrice===purchasePrice&&saved.sellingPrice===sellingPrice){
    return c.json({data:saved},200);
  }
  return c.json({error:'Product save refused'},409);
});

export default app;
