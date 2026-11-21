/**
 * M09 Owner Invoice Studio HTTP installer.
 *
 * NOT mounted by public RPC or any hosted Worker in this PR. M03 owns the
 * existing private Owner Worker entrypoint and must provide the existing
 * protectLogin + limitBody middleware and a VERIFIED current Owner context.
 * Never accept a Shop D1, Owner subject, role or token from the browser body.
 */
import {readOwnerInvoiceProfile,saveOwnerInvoiceProfile}
  from './m09-owner-invoice-profile.js';

export function registerOwnerInvoiceProfileRoutes(app,{protectLogin,limitBody,currentOwnerContext}={}){
  if(typeof app?.get!=='function'||typeof app?.post!=='function' ||
     typeof protectLogin!=='function'||typeof currentOwnerContext!=='function' ||
     typeof limitBody!=='function')throw new TypeError('Trusted M03 Owner route integration required');

  const enabled=c=>c.env?.OWNER_INVOICE_PROFILE_ENABLED==='true'&&
    c.env?.OWNER_WRITE_GRANTS_ENABLED==='true';
  const unavailable=c=>c.json({success:false,message:'Invoice preview preferences unavailable'},503);
  const denied=c=>c.json({success:false,message:'Owner or business access unavailable'},403);
  const shape=record=>record?.status==='ok'&&record.profile&&
    (record.revision===null||typeof record.revision==='string');

  app.get('/api/owner/invoice-profile',protectLogin,async c=>{
    if(!enabled(c))return c.notFound();
    try{
      const current=await currentOwnerContext(c);
      if(!current||!current.token||!current.scope?.shopId)return denied(c);
      const result=await readOwnerInvoiceProfile(current.scope,{token:current.token});
      if(result.status==='denied')return denied(c);
      if(!shape(result))return unavailable(c);
      return c.json({success:true,data:{shopId:current.scope.shopId,
        profile:result.profile,revision:result.revision}});
    }catch{return unavailable(c);}
  });

  app.post('/api/owner/invoice-profile',protectLogin,limitBody,async c=>{
    if(!enabled(c))return c.notFound();
    if(c.req.header('Content-Type')?.split(';')[0].trim().toLowerCase()!=='application/json')
      return c.json({success:false,message:'Expected JSON'},415);
    let input;
    try{input=await c.req.json();}
    catch{return c.json({success:false,message:'Invalid JSON'},400);}
    if(!input||typeof input!=='object'||Array.isArray(input)||
       Object.keys(input).length!==2||
       !Object.hasOwn(input,'expectedRevision')||!Object.hasOwn(input,'profile'))
      return c.json({success:false,message:'Invalid invoice preview change'},400);
    try{
      const current=await currentOwnerContext(c);
      if(!current||!current.token||!current.scope?.shopId)return denied(c);
      const result=await saveOwnerInvoiceProfile(current.scope,{
        token:current.token,expectedRevision:input.expectedRevision,profile:input.profile
      });
      if(result.status==='saved')return c.json({success:true,data:{
        shopId:current.scope.shopId,profile:result.profile,revision:result.revision
      }},200);
      if(result.status==='invalid')
        return c.json({success:false,message:'Unsupported invoice preview change'},400);
      if(result.status==='denied')return denied(c);
      if(result.status==='denied-or-stale')
        return c.json({success:false,message:'Business preferences changed or access expired'},409);
      return unavailable(c);
    }catch{return unavailable(c);}
  });
}
