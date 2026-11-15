/**
 * M09 pure original Settings and Invoice Design bootstrap projections.
 *
 * Frozen authority: Settings.gs::getSettingsBootstrap and
 * getInvoiceDesignBootstrap, Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 * Caller MUST independently enforce settings:view and read tenant-scoped
 * source Settings / BANK_ACCOUNTS, or resolve the logo under approved storage
 * policy. No D1, permissions, RPC, mutating Settings or logo uploads here.
 */
const MAX_LOGO_BYTES=1.5*1024*1024;
const LOGO_URI=/^data:image\/(?:png|jpeg|webp|gif);base64,([A-Za-z0-9+/=]*)$/;
const CANONICAL_BASE64=/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const RESERVED_KEYS=new Set(['__proto__','prototype','constructor']);

function plain(value){
  return value!==null && typeof value==='object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype ||
      Object.getPrototypeOf(value)===null);
}
function own(row,key){
  const desc=Object.getOwnPropertyDescriptor(row,key);
  if(desc && !Object.hasOwn(desc,'value'))
    throw new TypeError('Untrusted Settings bootstrap accessor '+key);
  return desc?.value;
}
function validatedRecord(record,label){
  if(!plain(record))throw new TypeError('Trusted '+label+' must be a plain object');
  const descriptors=Object.getOwnPropertyDescriptors(record);
  for(const key of Reflect.ownKeys(descriptors)){
    const desc=descriptors[key];
    if(typeof key!=='string' || !Object.hasOwn(desc,'value'))
      throw new TypeError('Untrusted '+label+' accessor or key');
  }
  return record;
}
function checkedScalar(value,key){
  if(value!==undefined && value!==null &&
     !['string','number','boolean'].includes(typeof value))
    throw new TypeError('Invalid Settings scalar: '+key);
  if(typeof value==='number' && !Number.isFinite(value) && !Number.isNaN(value))
    throw new TypeError('Invalid finite Settings scalar: '+key);
  return value;
}
function snapshotSettings(settingsMap){
  validatedRecord(settingsMap,'Settings map');
  const copy={};
  for(const key of Object.keys(settingsMap)){
    if(RESERVED_KEYS.has(key))
      throw new TypeError('Unsafe Settings map key: '+key);
    copy[key]=checkedScalar(own(settingsMap,key),key);
  }
  return copy;
}

/**
 * Exact frozen success response {settings,bankAccounts} for valid
 * source-shaped data. Untrusted, duplicate active Bank Account IDs reject
 * instead of returning ambiguous payment dropdown values.
 */
export function projectSettingsBootstrap(settingsMap,bankAccounts){
  const settings=snapshotSettings(settingsMap);
  if(!Array.isArray(bankAccounts))
    throw new TypeError('Trusted Bank Accounts must be a loaded array');
  const selected=[];
  const seen=new Set();
  for(const row of bankAccounts){
    validatedRecord(row,'Bank Account row');
    const status=own(row,'Status');
    if(status!==undefined && status!==null && typeof status!=='string')
      throw new TypeError('Invalid Bank Account Status');
    if(status==='Inactive')continue;
    const id=own(row,'Bank Account ID');
    const name=own(row,'Account Name');
    if(typeof id!=='string'||!id.trim())
      throw new TypeError('Invalid Bank Account ID');
    if(typeof name!=='string')
      throw new TypeError('Invalid Bank Account Name');
    if(seen.has(id))
      throw new TypeError('Duplicate Bank Account ID in Settings bootstrap: '+id);
    seen.add(id);
    selected.push({id,name});
  }
  return {settings,bankAccounts:selected};
}

function trustedLogoDataUri(value){
  if(typeof value!=='string')
    throw new TypeError('Trusted Invoice logo data URI must be a string');
  if(value==='')return '';
  const match=value.match(LOGO_URI);
  if(!match || !CANONICAL_BASE64.test(match[1]))
    throw new TypeError('Invalid trusted Invoice logo image base64 URI');
  const payload=match[1];
  const pad=payload.endsWith('==')?2:payload.endsWith('=')?1:0;
  const bytes=payload.length/4*3-pad;
  if(bytes>MAX_LOGO_BYTES)
    throw new RangeError('Invoice logo image exceeds source size limit');
  return value;
}

/**
 * Exact frozen success response {settings,logoDataUri} for trusted data.
 * Caller supplies an already-resolved logo; no Drive/File/blob access.
 */
export function projectInvoiceDesignBootstrap(settingsMap,logoDataUri){
  const settings=snapshotSettings(settingsMap);
  return {settings,logoDataUri:trustedLogoDataUri(logoDataUri)};
}
