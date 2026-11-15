/**
 * M09 source-faithful, INTERNAL Settings update validation preflight.
 *
 * Frozen source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2,
 * Settings.gs::updateSettings and Utils.gs numeric/sanitization helpers.
 *
 * Returns an ORDERED WRITE PROPOSAL, NEVER executes it. A real future D1
 * Settings writer must still use M04 settings.edit, current session/role
 * authority inside a database-enforced update, CAS and tenant isolation.
 */
const EDITABLE=[
  'Shop Name','Shop Name Bangla','Shop Description','Address','Phone 1','Phone 2','Email',
  'Currency Symbol','Currency Code',
  'Tax Percent','Default Discount','Low Stock Threshold',
  'Invoice Payment Methods','Invoice Terms',
  'Invoice Payment Terms Days','Invoice Payment Terms Text',
  'Invoice Footer','Invoice Proprietor Name','Invoice Proprietor Paragraph','Invoice Title',
  'Invoice Show Bismillah','Invoice Bismillah Text','Invoice Show Signature',
  'Drive Folder Id','Timezone','Receipt Size',
  'Delete Confirmation Key','Day Book Editable Days',
  'Default Bank Account','POS Show Purchase Price'
];
const NUMERIC=[
  'Tax Percent','Default Discount','Low Stock Threshold',
  'Day Book Editable Days','Invoice Payment Terms Days'
];
const BOOLEAN=[
  'Invoice Show Bismillah','Invoice Show Signature','POS Show Purchase Price'
];
const RESERVED=new Set(['__proto__','prototype','constructor']);
const NUMERIC_SET=new Set(NUMERIC);
const BOOLEAN_SET=new Set(BOOLEAN);

function plain(value){
  return value!==null && typeof value==='object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value)===Object.prototype ||
      Object.getPrototypeOf(value)===null);
}
function own(row,key){
  return Object.getOwnPropertyDescriptor(row,key)?.value;
}
function trustedRecord(row,label){
  if(!plain(row))throw new TypeError('Untrusted '+label+' object');
  for(const key of Reflect.ownKeys(row)){
    if(typeof key!=='string'||RESERVED.has(key))
      throw new TypeError('Unsafe '+label+' key');
    const desc=Object.getOwnPropertyDescriptor(row,key);
    if(!Object.hasOwn(desc,'value'))
      throw new TypeError('Untrusted '+label+' accessor');
    const value=desc.value;
    if(value!==undefined && value!==null &&
      !['string','number','boolean'].includes(typeof value))
      throw new TypeError('Invalid '+label+' scalar');
    if(typeof value==='number' && !Number.isFinite(value) &&
        !Number.isNaN(value))
      throw new TypeError('Invalid finite '+label+' scalar');
  }
  return row;
}
function trustedBankIds(accounts){
  if(!Array.isArray(accounts))
    throw new TypeError('Trusted Bank Account source snapshot must be a loaded array');
  const ids=new Set();
  for(const row of accounts){
    if(!plain(row))throw new TypeError('Untrusted Bank Account row');
    for(const desc of Object.values(Object.getOwnPropertyDescriptors(row))){
      if(!Object.hasOwn(desc,'value'))
        throw new TypeError('Untrusted Bank Account row accessor');
    }
    const id=own(row,'Bank Account ID');
    if(typeof id!=='string' || !id.trim())
      throw new TypeError('Invalid trusted Bank Account ID');
    ids.add(id); // Frozen source checks all rows, even Inactive.
  }
  return ids;
}
const sanitize=value=>value==null?'':String(value).trim();
const reject=error=>({success:false,error,writes:[]});

/**
 * Equivalent source validation and key/value conversion for a valid
 * source-shaped payload. Proposals are not an authorized D1 commit.
 */
export function planSettingsUpdate(payload,bankAccounts){
  if(payload===null || payload===undefined)
    return reject('No settings data received.');
  trustedRecord(payload,'Settings payload');

  if(own(payload,'Shop Name')!==undefined &&
      !sanitize(own(payload,'Shop Name')))
    return reject('Shop Name is required.');

  for(const key of NUMERIC){
    const value=own(payload,key);
    if(value===undefined || value==='')continue;
    const numeric=Number(value);
    if(Number.isNaN(numeric) || !Number.isFinite(numeric) || numeric<0)
      return reject('"'+key+'" must be a valid non-negative number.');
  }

  const bank=own(payload,'Default Bank Account');
  if(bank){
    const ids=trustedBankIds(bankAccounts);
    if(!ids.has(bank))
      return reject('Selected default bank account no longer exists.');
  }

  for(const key of ['Invoice Payment Methods','Invoice Terms']){
    const value=own(payload,key);
    if(value===undefined || sanitize(value)==='')continue;
    let parsed;
    try{parsed=JSON.parse(value);}catch{parsed=null;}
    if(!Array.isArray(parsed))
      return reject('"'+key+'" must be valid JSON (an array), e.g. [{"label":"বিকাশ","value":"01711-234567"}].');
  }

  const writes=[];
  for(const key of EDITABLE){
    const value=own(payload,key);
    if(value===undefined)continue;
    const converted=NUMERIC_SET.has(key)?Number(value||0):
      BOOLEAN_SET.has(key)?(value===true||value==='true'?'true':'false'):
      sanitize(value);
    writes.push({key,value:converted});
  }

  return {success:true,data:'Settings saved.',writes};
}
