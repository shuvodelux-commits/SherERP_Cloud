import {createTrustedFirstMfaOperator} from './port-p3-activation-challenge.js';

const actions=new Map([
  ['/challenge',['issueChallenge',['setupToken']]],
  ['/activate',['activate',['setupToken','challengeToken','credential','code']]],
  ['/receipt',['readReceipt',['challengeToken']]],
]);
const maxBytes=9000;
const reply=(status,result)=>Response.json(result,{
  status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'},
});
const hidden=()=>reply(404,{accepted:false});

async function readInput(request){
  const reader=request.body?.getReader();
  if(!reader)return null;
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let bytes=0,text='';
  try{
    for(;;){
      const {value,done}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>maxBytes){
        await reader.cancel();
        return null;
      }
      text+=decoder.decode(value,{stream:true});
    }
    return JSON.parse(text+decoder.decode());
  }finally{
    reader.releaseLock();
  }
}

/** Private adapter. Its host process must bind the listener to loopback. */
export async function createPrivateFirstMfaHandler(config){
  const operator=await createTrustedFirstMfaOperator(config);
  const bearer=config?.operatorBearer;
  return async request=>{
    const url=new URL(request.url);
    const action=actions.get(url.pathname);
    if(!operator || !action || request.method!=='POST' || url.protocol!=='http:' ||
       url.hostname!=='127.0.0.1' || url.search || request.headers.has('Origin') ||
       request.headers.has('Cookie'))return hidden();
    const authorization=request.headers.get('Authorization') ?? '';
    if(!/^Bearer [0-9a-f]{64}$/.test(authorization))return hidden();
    const supplied=authorization.slice(7);
    let difference=0;
    for(let i=0;i<bearer.length;i++)difference|=supplied.charCodeAt(i)^bearer.charCodeAt(i);
    if(difference!==0)return hidden();
    const [method,keys]=action;
    let input;
    try{
      if(request.headers.get('Content-Type')!=='application/json')return reply(400,{accepted:false});
      input=await readInput(request);
    }catch{return reply(400,{accepted:false});}
    if(!input || Object.getPrototypeOf(input)!==Object.prototype ||
       Object.keys(input).length!==keys.length ||
       !keys.every(key=>Object.hasOwn(input,key)&&typeof input[key]==='string')){
      return reply(400,{accepted:false});
    }
    try{
      const result=await operator[method]({...input,bearer:supplied});
      return result?reply(200,result===true?{accepted:true}:result):reply(409,{accepted:false});
    }catch{return reply(503,{accepted:false});}
  };
}
