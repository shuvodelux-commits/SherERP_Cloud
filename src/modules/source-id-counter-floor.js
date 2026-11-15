/**
 * M03 read-only high-water preflight for frozen Utils.gs generateId_ logic.
 *
 * This returns an ID PREVIEW, not a reservation or allocation. The future
 * issuer must use an approved, tenant-scoped, SQL-atomic D1 counter guard.
 * Inputs are from a trusted source export and pinned ID prefix mapping.
 */
export function planSourceIdCounterFloor({
  idKey,prefix,storedCounter,existingIds,padLength=6
}={}){
  if(typeof idKey!=='string'||!/^[A-Z][A-Z0-9_]{0,63}$/.test(idKey) ||
     typeof prefix!=='string'||!/^[A-Z][A-Z0-9]{0,15}$/.test(prefix)){
    throw new TypeError('Invalid source ID key or prefix');
  }
  if(!Number.isInteger(padLength)||padLength<1||padLength>32){
    throw new TypeError('Invalid original ID pad length');
  }
  if(!Array.isArray(existingIds) ||
     Object.getPrototypeOf(existingIds)!==Array.prototype){
    throw new TypeError('Invalid original source ID column snapshot');
  }

  let sourceCounter;
  if(storedCounter==null||storedCounter===''){
    sourceCounter=0;
  }else if(typeof storedCounter==='number'){
    sourceCounter=storedCounter;
  }else if(typeof storedCounter==='string' && /^\d+$/.test(storedCounter)){
    sourceCounter=Number(storedCounter);
  }else{
    throw new TypeError('Invalid recorded source ID counter');
  }
  if(!Number.isSafeInteger(sourceCounter)||sourceCounter<0){
    throw new RangeError('Invalid or unsafe source ID counter');
  }

  let highestExisting=0;
  const family=prefix+'-';
  const seen=new Set();
  for(let i=0;i<existingIds.length;i++){
    // Imported Sheet ID columns must be dense, ordinary own string cells.
    // Never invoke an accessor while treating a snapshot as trusted data.
    const d=Object.getOwnPropertyDescriptor(existingIds,String(i));
    if(!d || !Object.hasOwn(d,'value') || typeof d.value!=='string'){
      throw new TypeError('Invalid original source ID column cell');
    }
    const id=d.value;
    if(!id.startsWith(family))continue;
    const suffix=id.slice(family.length);
    if(!/^\d+$/.test(suffix)){
      throw new Error('Invalid or ambiguous source ID sequence');
    }
    const n=Number(suffix);
    if(!Number.isSafeInteger(n)){
      throw new RangeError('Unsafe source ID sequence');
    }
    if(seen.has(n)){
      throw new Error('Duplicate source ID sequence; repair import before allocation');
    }
    seen.add(n);
    if(n>highestExisting)highestExisting=n;
  }

  const floor=Math.max(sourceCounter,highestExisting);
  if(floor>=Number.MAX_SAFE_INTEGER){
    throw new RangeError('Source ID counter exhausted safe integer range');
  }
  return {
    idKey,prefix,storedCounter:sourceCounter,highestExisting,floor,
    nextPreviewId:family+String(floor+1).padStart(padLength,'0')
  };
}
