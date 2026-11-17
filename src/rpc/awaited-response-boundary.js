/**
 * M03 Run 2: last-mile JSON readiness guard for trusted private RPC bridges.
 *
 * Top-level awaits alone do not resolve Promise-valued nested D1 results.
 * JSON.stringify silently converts a Promise to {}, NaN to null and sparse
 * array slots to null. Never return those as source-shaped success payloads.
 *
 * This function only inspects OWN DATA descriptors. It never invokes a
 * getter/thenable/toJSON, recursively waits, normalizes, or mutates output.
 * It is NOT authentication, an RPC allowlist, source-schema validation, a
 * write grant or a replacement for existing per-method response checks.
 */
const BAD_KEYS=new Set(['__proto__','prototype','constructor','then','toJSON']);
const MAX_DEPTH=32;
const MAX_NODES=10000;
const invalid=()=>new Error('Invalid or unresolved M03 RPC response tree');

export function assertFullyResolvedRpcValue(value){
  const ancestors=new WeakSet();
  let nodes=0;
  function visit(node,depth){
    if(++nodes>MAX_NODES || depth>MAX_DEPTH)throw invalid();
    if(node===null || typeof node==='string' || typeof node==='boolean')return;
    if(typeof node==='number'){
      if(!Number.isFinite(node))throw invalid();
      return;
    }
    if(typeof node!=='object')throw invalid();
    if(ancestors.has(node))throw invalid();
    const proto=Object.getPrototypeOf(node);
    const array=Array.isArray(node);
    if(array?proto!==Array.prototype:(proto!==null&&proto!==Object.prototype))
      throw invalid();
    ancestors.add(node);
    try{
      const keys=Reflect.ownKeys(node);
      if(array){
        const len=Object.getOwnPropertyDescriptor(node,'length');
        if(!len || !Object.hasOwn(len,'value') ||
           !Number.isSafeInteger(len.value)||len.value<0 ||
           keys.length!==len.value+1)throw invalid();
        for(let i=0;i<len.value;i++){
          const field=Object.getOwnPropertyDescriptor(node,String(i));
          if(!field?.enumerable || !Object.hasOwn(field,'value'))
            throw invalid();
          visit(field.value,depth+1);
        }
      }else{
        for(const key of keys){
          if(typeof key!=='string' || BAD_KEYS.has(key))throw invalid();
          const field=Object.getOwnPropertyDescriptor(node,key);
          if(!field?.enumerable || !Object.hasOwn(field,'value'))
            throw invalid();
          visit(field.value,depth+1);
        }
      }
    }finally{ancestors.delete(node);}
  }
  try{visit(value,0);}
  catch{throw invalid();}
  return true;
}
