/**
 * M03 internal-only browser RPC compatibility contract for the original
 * DayBook.gs#getDayBookBootstrap(token).
 *
 * This module is NOT imported by src/index.js, public registry or previews.
 * The existing M09 D1 reader enforces current M04 session and daybook.view
 * in one authorized SELECT. This bridge only validates the browser method/
 * args and wraps the fully awaited data in the frozen source RPC envelope.
 * There is no tenant-aware public authentication, cash, or posting path here.
 */
import {createM09AuthorizedDayBookBootstrapReader}
  from '../modules/m09-authorized-daybook-bootstrap.js';

const NAME='getDayBookBootstrap';
const TOKEN=/^[0-9a-f]{64}$/;
const INVALID=Object.freeze({success:false,message:'Invalid RPC arguments'});
const UNKNOWN=Object.freeze({success:false,message:'RPC method not migrated'});
const UNAVAILABLE=Object.freeze({
  success:false,message:'Day Book is unavailable or access denied.'
});

function input(request){
  if(!request||typeof request!=='object'||Array.isArray(request) ||
     (Object.getPrototypeOf(request)!==Object.prototype &&
      Object.getPrototypeOf(request)!==null))
    return null;
  const keys=Reflect.ownKeys(request);
  if(keys.length!==2 || keys.some(k=>typeof k!=='string' ||
      (k!=='fnName'&&k!=='args')))return null;
  const fields=Object.getOwnPropertyDescriptors(request);
  for(const name of ['fnName','args']){
    if(!fields[name]?.enumerable||!Object.hasOwn(fields[name],'value'))
      return null;
  }
  const fnName=fields.fnName.value,args=fields.args.value;
  if(typeof fnName!=='string' || fnName.length<1 || fnName.length>80 ||
     !Array.isArray(args) || Object.getPrototypeOf(args)!==Array.prototype ||
     args.length!==1 || Reflect.ownKeys(args).length!==2)
    return null;
  const first=Object.getOwnPropertyDescriptor(args,'0');
  if(!first?.enumerable||!Object.hasOwn(first,'value'))
    return null;
  return {fnName,token:first.value};
}

/**
 * The clock is injected only by trusted server-side composition/tests;
 * never accept role, nowMs, permission, actor, SQL or clock from the RPC.
 */
export function createM03DayBookRpcBridge(env,{now=Date.now}={}){
  return Object.freeze({
    async invoke(request){
      const payload=input(request);
      if(payload===null)return {...INVALID};
      if(payload.fnName!==NAME)return {...UNKNOWN};
      if(typeof payload.token!=='string'||!TOKEN.test(payload.token))
        return {...INVALID};
      try {
        const nowMs=now();
        if(!Number.isSafeInteger(nowMs)||nowMs<0)
          return {...UNAVAILABLE};
        const data=await createM09AuthorizedDayBookBootstrapReader(env)
          .getBootstrap({token:payload.token,nowMs});
        return {success:true,data};
      }catch{
        // Do not disclose D1 errors, auth state, SQL, Settings or bearer.
        return {...UNAVAILABLE};
      }
    }
  });
}
