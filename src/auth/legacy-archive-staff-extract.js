/**
 * M04 protected OFFLINE-only Users/ROLES snapshot projection from the original
 * verified historical SQLite archive. It never selects old SESSIONS bearer
 * tokens, writes D1, logs source values or exposes a Worker/RPC endpoint.
 *
 * Returned snapshot contains PRIVATE legacy passwords/identity data. Consume
 * only inside an owner-controlled, trusted offline preflight and never export.
 * This is not authorization for D1 staff import, phone repair, login or cutover.
 */
import {verifyPrivateArchiveRows} from '../../scripts/dry-run-archive-row-proof.mjs';

const fail=()=>new Error('M04 private staff archive extraction rejected');
const USER_FIELDS=Object.freeze([
 'User ID','Full Name','Mobile Number','Password Hash','Password Salt',
 'Role','Status','Created By','Created At','Last Login',
]);
const ROLE_FIELDS=Object.freeze([
 'Role ID','Role Name','Allowed Modules','Permissions','Status','Created At',
]);
const DATE_CELLS=Object.freeze({
 legacy_users:Object.freeze([
  Object.freeze({field:'Created At',letter:'I',style:'5'}),
  Object.freeze({field:'Last Login',letter:'J',style:'4',allowEmpty:true}),
 ]),
 legacy_roles:Object.freeze([
  Object.freeze({field:'Created At',letter:'F',style:'5'}),
 ]),
});
const DATE_SERIAL=/^[0-9]{5}(?:\.[0-9]{1,15})?$/;

/** Fixed identifiers only; the workbook never supplies a SQL table name. */
function privateSourceRows(db,table,fields){
 const cells=DATE_CELLS[table];
 const query='SELECT __excel_row,__cells_json,'+
  fields.map(x=>'"'+x+'"').join(',')+
  ' FROM "'+table+'" WHERE __has_data=1 ORDER BY __excel_row';
 const originals=db.prepare(query).all();
 if(!Array.isArray(originals)||!originals.length||originals.length>10000)
  throw fail();
 const result=[];
 let prior=1;
 for(const original of originals){
  if(!Number.isSafeInteger(original.__excel_row)||original.__excel_row<=prior)
   throw fail();
  prior=original.__excel_row;
  const metadata=JSON.parse(original.__cells_json);
  if(!metadata||typeof metadata!=='object'||Array.isArray(metadata))throw fail();
  const record=Object.create(null);
  for(const field of fields)record[field]=original[field];
  for(const {field,letter,style,allowEmpty} of cells){
   const value=record[field];
   if(value===''&&allowEmpty)continue;
   const entry=Object.getOwnPropertyDescriptor(metadata,letter)?.value;
   if(typeof value!=='string'||!DATE_SERIAL.test(value)||
      !entry||typeof entry!=='object'||Array.isArray(entry)||
      Object.getOwnPropertyDescriptor(entry,'t')?.value!=='n'||
      Object.getOwnPropertyDescriptor(entry,'s')?.value!==style||
      Object.getOwnPropertyDescriptor(entry,'v')?.value!==value)
    throw fail();
  }
  result.push(record);
 }
 return result;
}

/**
 * Require the merged M02 verifier's whole-archive integrity proof *before*
 * returning any private staff credentials to the trusted caller.
 */
export function extractPrivateLegacyStaffFromArchive(db){
 try {
  if(!db||typeof db.prepare!=='function')throw fail();
  const proven=verifyPrivateArchiveRows(db);
  if(proven.sourceGroups!==49||proven.sheets!==50||
     !proven.workbookSha256Verified||
     proven.rowHashesVerified!==proven.physicalRows)throw fail();
  const users=privateSourceRows(db,'legacy_users',USER_FIELDS);
  const roles=privateSourceRows(db,'legacy_roles',ROLE_FIELDS);
  return {
   snapshot:{users,roles},
   report:Object.freeze({
    scope:'M04-offline-verified-archive-staff-extraction',
    users:users.length,roles:roles.length,
    verifiedArchivePhysicalRows:proven.physicalRows,
    originalSourceRowsChanged:false,
    excludedLegacySessions:true,
    sourceDatesStillUnconverted:true,
    spreadsheetTimezoneVerified:false,
    staffIdentityReconciled:false,
    legacyStaffImportAuthorized:false,
    publicAuthenticationEnabled:false,
    productionReady:false,
   }),
  };
 }catch{
  throw fail();
 }
}
