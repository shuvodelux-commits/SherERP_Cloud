/**
 * M04 offline-only historical staff timestamp *preparation*, not provenance
 * approval. The pinned Apps Script manifest says Asia/Dhaka; the verified
 * workbook has the Excel 1900 date system. The Google Sheet timezone has NOT
 * been independently attested and must be reviewed before an actual import.
 *
 * This file reads no storage, exposes no HTTP method and performs no writes.
 * Its detached snapshot is PRIVATE source data; never log or commit it.
 */
const fail=()=>new Error('M04 private source timestamp preparation rejected');
const SERIAL=/^[0-9]{5}(?:\.[0-9]{1,15})?$/;
const EPOCH=Date.UTC(1899,11,30);
const MS_PER_DAY=86_400_000;
const DHAKA_OFFSET_MS=6*60*60*1000;
const MIN_SERIAL=40179; // 2010-01-01; exclude historical Dhaka DST era.
const MAX_SERIAL=73050;
const USER_FIELDS=Object.freeze([
 'User ID','Full Name','Mobile Number','Password Hash','Password Salt',
 'Role','Status','Created By','Created At','Last Login',
]);
const ROLE_FIELDS=Object.freeze([
 'Role ID','Role Name','Allowed Modules','Permissions','Status','Created At',
]);

/**
 * Excel 1900 serial as Asia/Dhaka wall clock -> provisional UTC timestamp.
 * Does not assert that the spreadsheet timezone matches the script timezone.
 * No 1904-workbook, Excel-1900-leap-bug era or datetime string coercion.
 */
export function excel1900DhakaSerialToUtc(sourceValue){
 if(typeof sourceValue!=='string'||!SERIAL.test(sourceValue))throw fail();
 const number=Number(sourceValue);
 if(!Number.isFinite(number)||number<MIN_SERIAL||number>MAX_SERIAL)throw fail();
 const utcMillis=EPOCH+Math.round(number*MS_PER_DAY)-DHAKA_OFFSET_MS;
 const date=new Date(utcMillis);
 const converted=date.toISOString();
 if(converted.slice(0,4)<'2010'||converted.slice(0,4)>'2100')throw fail();
 return converted;
}
function takeRows(source,fields){
 if(!Array.isArray(source)||source.length<1||source.length>10000||
    Object.getPrototypeOf(source)!==Array.prototype||
    Reflect.ownKeys(source).length!==source.length+1)throw fail();
 return source.map((_,i)=>{
  const item=Object.getOwnPropertyDescriptor(source,String(i));
  if(!item?.enumerable||!Object.hasOwn(item,'value'))throw fail();
  const row=item.value;
  if(!row||typeof row!=='object'||Array.isArray(row)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(row)))throw fail();
  const names=Reflect.ownKeys(row);
  if(names.length!==fields.length||
     names.some(k=>typeof k!=='string'||!fields.includes(k)))throw fail();
  const output=Object.create(null);
  for(const field of fields){
   const descriptor=Object.getOwnPropertyDescriptor(row,field);
   if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))throw fail();
   output[field]=descriptor.value;
  }
  return output;
 });
}
/**
 * Return a detached PRIVATE staff copy for later protected M04 preflight.
 * Source IDs, phone text (including invalid values), secrets and RBAC are
 * copied byte-for-byte and NEVER auto-corrected. Empty Last Login stays empty.
 */
export function provisionallyConvertLegacyStaffExcelDates(source,options){
 try {
  if(!source||typeof source!=='object'||Array.isArray(source)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(source))||
     Reflect.ownKeys(source).length!==2||
     !Object.hasOwn(source,'users')||!Object.hasOwn(source,'roles'))throw fail();
  for(const key of ['users','roles']){
   const descriptor=Object.getOwnPropertyDescriptor(source,key);
   if(!descriptor?.enumerable||!Object.hasOwn(descriptor,'value'))throw fail();
  }
  if(!options||typeof options!=='object'||Array.isArray(options)||
     ![Object.prototype,null].includes(Object.getPrototypeOf(options))||
     Reflect.ownKeys(options).length!==2||
     !Object.hasOwn(options,'workbookEpoch')||
     !Object.hasOwn(options,'scriptTimeZone'))throw fail();
  const workbookEpoch=Object.getOwnPropertyDescriptor(options,'workbookEpoch');
  const scriptTimeZone=Object.getOwnPropertyDescriptor(options,'scriptTimeZone');
  if(!Object.hasOwn(workbookEpoch,'value')||workbookEpoch.value!==1900||
     !Object.hasOwn(scriptTimeZone,'value')||
     scriptTimeZone.value!=='Asia/Dhaka')throw fail();

  const users=takeRows(Object.getOwnPropertyDescriptor(source,'users').value,USER_FIELDS);
  const roles=takeRows(Object.getOwnPropertyDescriptor(source,'roles').value,ROLE_FIELDS);
  let convertedTimestamps=0;
  for(const user of users){
   user['Created At']=excel1900DhakaSerialToUtc(user['Created At']);
   convertedTimestamps++;
   if(user['Last Login']!==''){
    user['Last Login']=excel1900DhakaSerialToUtc(user['Last Login']);
    convertedTimestamps++;
   }
  }
  for(const role of roles){
   role['Created At']=excel1900DhakaSerialToUtc(role['Created At']);
   convertedTimestamps++;
  }
  return {
   snapshot:{users,roles},
   report:Object.freeze({
    scope:'M04-private-offline-provisional-time-projection',
    users:users.length,roles:roles.length,convertedTimestamps,
    originalSourceChanged:false,
    spreadsheetTimezoneVerified:false,
    historicalStaffIdentityReconciled:false,
    sourcePasswordUpgradeApproved:false,
    legacyStaffImportAuthorized:false,
    publicAuthenticationEnabled:false,
    productionReady:false,
   }),
  };
 }catch{throw fail();}
}
