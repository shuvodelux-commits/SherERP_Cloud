/**
 * M03 internal versioned operation-intent fingerprint.
 *
 * This is metadata for a future authenticated D1 operation-ID receipt, NOT an
 * authorization, idempotency execution or business posting implementation.
 * Tenant and actor identities MUST come from validated server-side context.
 */
const DOMAIN='SherERP:operation-intent:v1\n';
const MAX_UTF8_BYTES=32768;
const MAX_DEPTH=16;
const MAX_NODES=4096;
const ID=/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const OPERATION_TYPE=/^[a-z][a-z0-9._-]{1,63}$/;
const FORBIDDEN_KEYS=new Set(['__proto__','prototype','constructor']);

function isPlainRecord(input){
  if(input===null || typeof input!=='object' || Array.isArray(input))return false;
  const proto=Object.getPrototypeOf(input);
  return proto===Object.prototype || proto===null;
}

function requireWellFormedUnicode(value){
  for(let index=0;index<value.length;index++){
    const code=value.charCodeAt(index);
    if(code>=0xD800 && code<=0xDBFF){
      if(index+1===value.length)throw new TypeError('Invalid Unicode surrogate string');
      const low=value.charCodeAt(++index);
      if(low<0xDC00 || low>0xDFFF)throw new TypeError('Invalid Unicode surrogate string');
    }else if(code>=0xDC00 && code<=0xDFFF){
      throw new TypeError('Invalid Unicode surrogate string');
    }
  }
  return value;
}

function requireDataProperty(input,key){
  const descriptor=Object.getOwnPropertyDescriptor(input,key);
  if(!descriptor || !Object.hasOwn(descriptor,'value') || !descriptor.enumerable){
    throw new TypeError('Unsupported accessor or nonenumerable JSON property');
  }
  return descriptor.value;
}

function canonicalize(value,depth,seen,counter){
  if(++counter.count>MAX_NODES || depth>MAX_DEPTH){
    throw new RangeError('Invalid operation intent depth or node limit');
  }
  if(value===null || typeof value==='boolean')return JSON.stringify(value);
  if(typeof value==='string'){
    if(value.length>MAX_UTF8_BYTES)throw new RangeError('Invalid operation intent string size');
    return JSON.stringify(requireWellFormedUnicode(value));
  }
  if(typeof value==='number'){
    if(!Number.isSafeInteger(value) || Object.is(value,-0)){
      throw new TypeError('Invalid operation intent number: use decimal strings for fractional values');
    }
    return JSON.stringify(value);
  }
  if(typeof value!=='object')throw new TypeError('Unsupported operation intent JSON value');
  if(seen.has(value))throw new TypeError('Invalid cyclic operation intent');
  seen.add(value);
  try{
    if(Array.isArray(value)){
      if(Object.getPrototypeOf(value)!==Array.prototype ||
         !Number.isSafeInteger(value.length) || value.length>MAX_NODES){
        throw new TypeError('Invalid operation intent array');
      }
      const keys=Reflect.ownKeys(value);
      if(keys.some(key=>{
        if(key==='length')return false;
        if(typeof key!=='string')return true;
        const position=Number(key);
        return !Number.isSafeInteger(position) || position<0 ||
          position>=value.length || String(position)!==key;
      }) || keys.length!==value.length+1){
        throw new TypeError('Invalid sparse or decorated operation intent array');
      }
      const entries=[];
      for(let i=0;i<value.length;i++){
        entries.push(canonicalize(requireDataProperty(value,String(i)),depth+1,seen,counter));
      }
      return '['+entries.join(',')+']';
    }
    if(!isPlainRecord(value))throw new TypeError('Unsupported operation intent object prototype');
    const keys=Reflect.ownKeys(value);
    if(keys.some(key=>typeof key!=='string' || FORBIDDEN_KEYS.has(key))){
      throw new TypeError('Invalid operation intent object key');
    }
    keys.sort();
    return '{'+keys.map(key=>{
      requireWellFormedUnicode(key);
      return JSON.stringify(key)+':'+
        canonicalize(requireDataProperty(value,key),depth+1,seen,counter);
    }).join(',')+'}';
  }finally{
    seen.delete(value);
  }
}

function requireContext(input){
  if(!isPlainRecord(input))throw new TypeError('Invalid operation intent context');
  const keys=Reflect.ownKeys(input);
  if(keys.length!==4 || keys.some(key=>typeof key!=='string') ||
     keys.sort().join(',')!=='actorId,operationType,payload,tenantId'){
    throw new TypeError('Invalid operation intent context keys');
  }
  const tenantId=requireDataProperty(input,'tenantId');
  const actorId=requireDataProperty(input,'actorId');
  const operationType=requireDataProperty(input,'operationType');
  const payload=requireDataProperty(input,'payload');
  if(typeof tenantId!=='string' || !ID.test(tenantId) ||
     typeof actorId!=='string' || !ID.test(actorId) ||
     typeof operationType!=='string' || !OPERATION_TYPE.test(operationType) ||
     !isPlainRecord(payload)){
    throw new TypeError('Invalid operation intent tenant, actor, type or payload');
  }
  return {tenantId,actorId,operationType,payload};
}

/**
 * SHA-256(UTF8("SherERP:operation-intent:v1\\n" + canonicalJSON)).
 * Uses WebCrypto in both Node and Cloudflare Workers.
 * Rejects ambiguous JSON values instead of silently coercing them.
 */
export async function hashCanonicalOperationIntent(input){
  const {tenantId,actorId,operationType,payload}=requireContext(input);
  const counter={count:0};
  const canonical='{"actorId":'+canonicalize(actorId,0,new WeakSet(),counter)+
    ',"operationType":'+canonicalize(operationType,0,new WeakSet(),counter)+
    ',"payload":'+canonicalize(payload,0,new WeakSet(),counter)+
    ',"tenantId":'+canonicalize(tenantId,0,new WeakSet(),counter)+'}';
  const bytes=new TextEncoder().encode(DOMAIN+canonical);
  if(bytes.byteLength>MAX_UTF8_BYTES)throw new RangeError('Invalid operation intent UTF-8 size limit');
  if(!globalThis.crypto?.subtle?.digest){
    throw new Error('Web Crypto SHA-256 unavailable for operation intent');
  }
  const hash=await globalThis.crypto.subtle.digest('SHA-256',bytes);
  if(hash.byteLength!==32)throw new Error('Invalid SHA-256 operation intent result');
  return Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,'0')).join('');
}
