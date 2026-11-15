/** Nondeployable fixture: fixed server-only operations; no client actor, token, time or SQL. */
import {createM03M04AuthorizedMasterCreator} from '../../src/modules/m03-m04-master-authorized-create.js';
const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const D='d'.repeat(64),E='e'.repeat(64),F='f'.repeat(64),G='1'.repeat(64);
const H='2'.repeat(64),J='3'.repeat(64),K='4'.repeat(64);
const NOW=1_800_000_000_000;
const operations=Object.freeze({
  '/__m03_m04_master__/admin-category':['createCategory_',A,'OP-ADMIN','Tools',NOW],
  '/__m03_m04_master__/admin-replay':['createCategory_',A,'OP-ADMIN',' Tools ',NOW],
  '/__m03_m04_master__/cross-actor':['createCategory_',B,'OP-ADMIN','Tools',NOW],
  '/__m03_m04_master__/admin-collision':['createCategory_',A,'OP-ADMIN','Changed',NOW],
  '/__m03_m04_master__/staff-unit':['createUnit_',B,'OP-STAFF','গিরা',NOW],
  '/__m03_m04_master__/staff-after-change':['createUnit_',B,'OP-STAFF-2','ফুট',NOW],
  '/__m03_m04_master__/no-add':['createUnit_',C,'OP-NOADD','Box',NOW],
  '/__m03_m04_master__/revoked':['createUnit_',D,'OP-REVOKE','Box',NOW],
  '/__m03_m04_master__/expired':['createUnit_',E,'OP-EXPIRE','Box',NOW],
  '/__m03_m04_master__/idle':['createUnit_',F,'OP-IDLE','Box',NOW],
  '/__m03_m04_master__/unknown':['createUnit_',G,'OP-UNKNOWN','Box',NOW],
  '/__m03_m04_master__/staff-fresh':['createUnit_',H,'OP-STAFF-FRESH','Box',NOW],
  '/__m03_m04_master__/staff-race':['createUnit_',J,'OP-STAFF-RACE','Meter',NOW],
  '/__m03_m04_master__/staff-malformed':['createUnit_',K,'OP-STAFF-MALFORMED','Meter',NOW],
  '/__m03_m04_master__/admin-after-password':['createCategory_',A,'OP-ADMIN-PASSWORD','Meter',NOW],
  '/__m03_m04_master__/fault':['createCategory_',A,'OP-FAULT','Fault',NOW],
  '/__m03_m04_master__/lost':['createCategory_',A,'OP-LOST','Tape',NOW],
  '/__m03_m04_master__/lost-replay':['createCategory_',A,'OP-LOST','Tape',NOW]
});
const json=(status,body)=>Response.json(body,{status,headers:{'Cache-Control':'no-store'}});
export default {
  async fetch(request,env){
    const path=new URL(request.url).pathname;
    if(!Object.hasOwn(operations,path))return json(404,{error:'Not found'});
    if(request.method!=='POST')return json(405,{error:'POST required'});
    try{
      const [method,token,operationId,name,nowMs]=operations[path];
      const service=createM03M04AuthorizedMasterCreator(env,{businessId:'BUS-A',now:()=>nowMs});
      const result=await service[method]({token,operationId,name});
      if(path==='/__m03_m04_master__/lost')
        return json(503,{error:'Simulated response lost after commit'});
      return json(200,result);
    }catch{
      return json(403,{error:'Operation denied or review required'});
    }
  }
};
