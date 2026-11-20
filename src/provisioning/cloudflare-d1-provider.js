/**
 * Minimal private Cloudflare D1 REST adapter for Option A.
 * This is NOT exported from any public Worker route. Create is allowed only
 * after a durable Control D1 claim by the private provisioner.
 * It must never try a second POST after an outcome-unknown create.
 */
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ACCOUNT=/^[0-9a-f]{32}$/;
const TOKEN=/^[A-Za-z0-9._~-]{10,512}$/;
const DB_NAME=/^shererp-shop-[0-9a-f]{32}$/;
const ATTEMPT=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}:shop-create$/;
const deny=()=>{throw new Error('D1_PROVIDER_DENIED');};

export function createCloudflareD1Provider({
  accountId,apiToken,maxDatabases,fetchFn=fetch
}={}){
  if(!ACCOUNT.test(accountId)||!TOKEN.test(apiToken)||
    !Number.isSafeInteger(maxDatabases)||maxDatabases<1||maxDatabases>1000||
    typeof fetchFn!=='function')deny();
  const base='https://api.cloudflare.com/client/v4/accounts/'+accountId+'/d1/database';
  const headers={Authorization:'Bearer '+apiToken,Accept:'application/json'};
  const validAction=action=>{
    if(!action||typeof action!=='object'||Array.isArray(action)||
      Object.keys(action).length!==3 ||
      action.accountId!==accountId||!DB_NAME.test(action.name)||
      !ATTEMPT.test(action.attemptId))deny();
  };
  const request=async (url,method,body)=>{
    const response=await fetchFn(url,{
      method,redirect:'error',cache:'no-store',
      headers:body?{...headers,'Content-Type':'application/json'}:headers,
      ...(body?{body:JSON.stringify(body)}:{}),
      signal:AbortSignal.timeout(10000),
    });
    if(!response?.ok||typeof response.json!=='function')throw Error('D1_RESPONSE_UNAVAILABLE');
    const data=await response.json();
    if(data?.success!==true)throw Error('D1_RESPONSE_UNAVAILABLE');
    return data;
  };
  async function inspectAccount(){
    let data;
    try{data=await request(base+'?per_page=1&page=1','GET');}
    catch{throw Error('D1_PROVIDER_UNAVAILABLE');}
    const count=data?.result_info?.total_count;
    if(!Array.isArray(data?.result)||!Number.isSafeInteger(count)||count<0||
       count<data.result.length)throw Error('D1_PROVIDER_UNAVAILABLE');
    return {accountId,usedDatabases:count,maximumDatabases:maxDatabases};
  }
  async function createDatabase(action){
    validAction(action);
    const status=await inspectAccount();
    if(status.usedDatabases>=status.maximumDatabases)
      throw Error('D1_CAPACITY_UNAVAILABLE');
    let data;
    try{data=await request(base,'POST',{name:action.name});}
    catch{throw Error('D1_CREATE_OUTCOME_UNKNOWN');}
    const id=data?.result?.uuid;
    if(!UUID.test(id)||data.result.name!==action.name)
      throw Error('D1_CREATE_OUTCOME_UNKNOWN');
    // This response is attributed to the single POST in the current claim.
    // A name match after a lost response is not sufficient attribution.
    return {...action,id,evidenceRef:'cf-d1:'+id};
  }
  async function findCreation(action){
    validAction(action);
    // Cloudflare D1's list/get endpoints do not expose our attemptId.
    // Do not infer ownership from a matching name or issue another POST.
    // Future trusted receipt storage may provide an exact attested lookup.
    return null;
  }
  return Object.freeze({inspectAccount,createDatabase,findCreation});
}
