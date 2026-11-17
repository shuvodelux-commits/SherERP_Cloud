/**
 * M04 OFFLINE-ONLY Administrator-first staff enrollment rehearsal.
 *
 * Input is TWO independently captured, protected, full historical USERS/ROLES
 * snapshots after verified archive extraction and source-time preparation.
 * One owner-approved six-digit Owner source phone remains intact and Active in
 * the immutable original archive, but cannot be enrolled into the strict
 * 11-digit phone_key D1 schema. Do not call this account "locked": no D1 user
 * record for it exists yet. A future audited Administrator-authorized source
 * identity claim is required for Owner enrollment after mobile correction.
 *
 * This helper neither grants public auth nor performs a remote D1 operation.
 * Private snapshots and the returned import subset contain credential values:
 * never log or commit them. Reports contain only counts and fixed flags.
 */
import {auditLegacyStaffImport} from './staff-import-audit.js';
import {auditLegacyStaffProvenance} from './staff-provenance-preflight.js';
import {auditStableLegacyStaffFreeze} from './two-pass-source-freeze.js';
import {importLegacyStaffSnapshotWithD1} from './d1-offline-staff-import.js';

const invalid=()=>new Error('M04 administrator-first offline preparation rejected');
const USER_FIELDS=Object.freeze([
 'User ID','Full Name','Mobile Number','Password Hash','Password Salt',
 'Role','Status','Created By','Created At','Last Login',
]);
const ROLE_FIELDS=Object.freeze([
 'Role ID','Role Name','Allowed Modules','Permissions','Status','Created At',
]);
const UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SOURCE_OWNER_PHONE=/^\d{6}$/;
const isCanonicalTime=v=>typeof v==='string'&&UTC.test(v)&&
  Number.isFinite(Date.parse(v))&&new Date(Date.parse(v)).toISOString()===v;

function exactRows(value,fields){
 if(!Array.isArray(value) || Object.getPrototypeOf(value)!==Array.prototype ||
    value.length>10000 || Reflect.ownKeys(value).length!==value.length+1)
   throw invalid();
 const rows=[];
 const seen=new Set();
 for(let i=0;i<value.length;i++){
  const index=Object.getOwnPropertyDescriptor(value,String(i));
  if(!index?.enumerable || !Object.hasOwn(index,'value'))throw invalid();
  const row=index.value;
  if(!row || typeof row!=='object' || Array.isArray(row) ||
     ![Object.prototype,null].includes(Object.getPrototypeOf(row)) ||
     seen.has(row))throw invalid();
  seen.add(row);
  const keys=Reflect.ownKeys(row);
  if(keys.length!==fields.length ||
     keys.some(k=>typeof k!=='string'||!fields.includes(k)))throw invalid();
  const copy=Object.create(null);
  for(const field of fields){
   const property=Object.getOwnPropertyDescriptor(row,field);
   if(!property?.enumerable || !Object.hasOwn(property,'value'))throw invalid();
   copy[field]=property.value;
  }
  rows.push(copy);
 }
 return {rows,identities:seen};
}
function capture(snapshot){
 if(!snapshot || typeof snapshot!=='object'||Array.isArray(snapshot)||
    ![Object.prototype,null].includes(Object.getPrototypeOf(snapshot)) ||
    Reflect.ownKeys(snapshot).length!==2)throw invalid();
 const u=Object.getOwnPropertyDescriptor(snapshot,'users');
 const r=Object.getOwnPropertyDescriptor(snapshot,'roles');
 if(!u?.enumerable||!r?.enumerable||
    !Object.hasOwn(u,'value')||!Object.hasOwn(r,'value'))throw invalid();
 const users=exactRows(u.value,USER_FIELDS);
 const roles=exactRows(r.value,ROLE_FIELDS);
 for(const row of users.identities)if(roles.identities.has(row))throw invalid();
 return {users:users.rows,roles:roles.rows,originalUsers:u.value,
   originalRoles:r.value,sourceIdentities:new Set([...users.identities,...roles.identities])};
}
function independentAndIdentical(first,second){
 if(first.originalUsers===second.originalUsers ||
    first.originalRoles===second.originalRoles ||
    first.users.length!==second.users.length ||
    first.roles.length!==second.roles.length)throw invalid();
 for(const row of second.sourceIdentities)
  if(first.sourceIdentities.has(row))throw invalid();
 for(const [name,fields] of [['users',USER_FIELDS],['roles',ROLE_FIELDS]]){
  for(let i=0;i<first[name].length;i++){
   const a=first[name][i],b=second[name][i];
   for(const field of fields)if(!Object.is(a[field],b[field]))throw invalid();
  }
 }
}
function approvedSingleOwnerException(capture){
 const report=auditLegacyStaffImport(capture.users,capture.roles);
 if(report.counts.activeAdministrators!==1||
    report.issues.length!==1 ||
    report.issues[0].scope!=='user' ||
    report.issues[0].code!=='USER_MOBILE_UNSUPPORTED' ||
    !Number.isSafeInteger(report.issues[0].row))throw invalid();
 const deferredIndex=report.issues[0].row;
 const originalOwner=capture.users[deferredIndex];
 if(!originalOwner||originalOwner.Role!=='Owner'||
    originalOwner.Status!=='Active'||
    typeof originalOwner['Mobile Number']!=='string' ||
    !SOURCE_OWNER_PHONE.test(originalOwner['Mobile Number']) ||
    typeof originalOwner['Created By']!=='string' ||
    !originalOwner['Created By'].trim() ||
    !isCanonicalTime(originalOwner['Created At']) ||
    (originalOwner['Last Login']!==''&&!isCanonicalTime(originalOwner['Last Login'])))
    throw invalid();
 const eligible=capture.users.filter((_,i)=>i!==deferredIndex);
 const subset={users:eligible,roles:capture.roles};
 const eligibleReport=auditLegacyStaffProvenance(subset);
 if(!eligibleReport.preflightPass ||
    eligibleReport.counts.activeAdministrators!==1)throw invalid();
 return {subset,deferredIndex};
}
/**
 * A deliberately PARTIAL enrollment of an otherwise complete historical
 * source roster. Never describe it as a full source import. Non-Owner staff
 * remain eligible only if every other source/RBAC/provenance check passes.
 */
export function prepareAdminFirstLegacyStaffEnrollment(first,confirmation){
 try{
  if(first===confirmation)throw invalid();
  const a=capture(first),b=capture(confirmation);
  independentAndIdentical(a,b);
  const aChecked=approvedSingleOwnerException(a);
  const bChecked=approvedSingleOwnerException(b);
  if(aChecked.deferredIndex!==bChecked.deferredIndex)throw invalid();
  // Reuse the strict existing two-pass freeze for the importable subset;
  // the complete source was independently compared above, including Owner.
  const freeze=auditStableLegacyStaffFreeze(aChecked.subset,bChecked.subset);
  if(!freeze.freezeMatch)throw invalid();
  return {
   snapshot:aChecked.subset,
   report:Object.freeze({
    scope:'M04-private-partial-administrator-first-enrollment',
    originalUsers:a.users.length,
    sourceRoles:a.roles.length,
    originalActiveAdministrators:1,
    importableUsers:aChecked.subset.users.length,
    deferredOwnerUsers:1,
    sourceTwoPassMatch:true,
    ownerSourceStatusChanged:false,
    ownerMobileRewritten:false,
    ownerAccountLocked:false,
    ownerEnrollmentDeferred:true,
    loginAvailableForDeferredOwner:false,
    originalSourceChanged:false,
    fullHistoricalStaffImportComplete:false,
    remoteD1ImportAuthorized:false,
    publicAuthenticationEnabled:false,
    productionReady:false,
   }),
  };
 }catch{
  throw invalid();
 }
}
/**
 * Test-only/privately gated D1 one-shot rehearsal. Uses the existing trusted
 * batch importer and source readback, never a second authority or posting
 * implementation. Target must be an isolated local Workerd/D1 fixture.
 */
export async function rehearseAdminFirstLegacyStaffImportWithD1(db,first,confirmation){
 const prepared=prepareAdminFirstLegacyStaffEnrollment(first,confirmation);
 const result=await importLegacyStaffSnapshotWithD1(db,prepared.snapshot);
 return {
  ...result,
  deferredOwnerUsers:prepared.report.deferredOwnerUsers,
  fullHistoricalStaffImportComplete:false,
 };
}
