/**
 * Internal M04 policy preparation. NOT registered as a Worker RPC handler.
 * This is a strict, JSON-safe port of RoleManagement.gs::sanitizePermissions_.
 * Source vocabulary: UI.gs::PERMISSION_MODULES / Auth.gs::DELETE_WINDOW_OPTIONS.
 * No session, D1 or client actor is trusted here.
 */
export const STAFF_PERMISSION_MODULES = Object.freeze([
  {key:'dashboard',label:'Dashboard'},
  {key:'pos',label:'POS'},
  {key:'sales',label:'Sales'},
  {key:'returns',label:'Sales Return'},
  {key:'purchase',label:'Purchases'},
  {key:'suppliers',label:'Suppliers'},
  {key:'vendors',label:'Vendor'},
  {key:'products',label:'Products'},
  {key:'customers',label:'Customers'},
  {key:'bank',label:'Bank Accounts'},
  {key:'expense',label:'Expenses'},
  {key:'finance',label:'Business Finance'},
  {key:'daybook',label:'Day Book'},
  {key:'cashReconciliation',label:'Cash Reconciliation'},
  {key:'reports',label:'Reports'},
  {key:'settings',label:'Settings'},
  {key:'users',label:'Users'},
  {key:'roles',label:'Roles'},
  {key:'openingBalance',label:'Opening Balance Edit',permissionMode:'editOnly'},
  {key:'settlementDiscount',label:'Settlement Discount',permissionMode:'editOnly'},
  {key:'posCost',label:'POS Purchase Price'},
].map((entry) => Object.freeze(entry)));

export const PERMISSION_WINDOW_CODES = Object.freeze([
  'disabled','same','1','3','7','15','30','unlimited',
]);

// Frozen Auth.gs::DELETE_WINDOW_OPTIONS UI labels, never authorization.
const PERMISSION_WINDOW_LABELS=Object.freeze({
  disabled:'Disabled',same:'Same Day',
  '1':'1 Day','3':'3 Days','7':'7 Days','15':'15 Days',
  '30':'30 Days',unlimited:'Unlimited',
});

/**
 * Frozen RoleManagement.gs::getRolesBootstrap display choices. This is
 * public metadata, NOT a permission decision. Return detached, JSON-safe
 * copies rather than mutable shared constants.
 */
export function roleBootstrapOptions(){
  return {
    moduleOptions:STAFF_PERMISSION_MODULES.map(({key,label,permissionMode})=>({
      key,label,permissionMode:permissionMode||'',
    })),
    deleteWindowOptions:PERMISSION_WINDOW_CODES.map(key=>({
      key,label:PERMISSION_WINDOW_LABELS[key],
    })),
  };
}

const windows = new Set(PERMISSION_WINDOW_CODES);
const management = new Set(['users','roles']);

function ownData(object, key) {
  if (object === null || typeof object !== 'object') return undefined;
  // Accessor, inherited and trapped properties must not grant permission.
  try {
    const descriptor = Object.getOwnPropertyDescriptor(object, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Return a JSON-serializable, allowlisted staff permission map.
 * Intentional hardening versus GAS: only literal true grants view/add/edit.
 * Backdate's legacy unlimited default is preserved for review; public
 * authorization must remain disabled until its policy is approved.
 */
export function sanitizeStaffPermissions(raw) {
  const out = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;

  for (const {key, permissionMode} of STAFF_PERMISSION_MODULES) {
    const input = ownData(raw, key);
    if (!input || typeof input !== 'object' || Array.isArray(input)) continue;

    const edit = ownData(input, 'edit') === true;
    if (permissionMode === 'editOnly') {
      if (edit) out[key] = {
        view:false, add:false, edit:true, delete:'disabled', backdate:'unlimited',
      };
      continue;
    }

    const view = ownData(input, 'view') === true;
    const add = ownData(input, 'add') === true;
    const rawDelete = ownData(input, 'delete');
    const isManagement = management.has(key);
    const del = isManagement
      ? rawDelete === true || rawDelete === 'unlimited'
      : windows.has(rawDelete) ? rawDelete : 'disabled';
    const rawBackdate = ownData(input, 'backdate');
    const backdate = windows.has(rawBackdate) ? rawBackdate : 'unlimited';

    if (view || add || edit || (isManagement ? del === true : del !== 'disabled')) {
      out[key] = {view, add, edit, delete:del, backdate};
    }
  }
  return out;
}

/**
 * Keep navigation projection separate from action rights. Never infer a
 * navigable right from add/edit/delete or special edit-only permissions.
 */
export function allowedStaffModules(normalized) {
  if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return [];
  return STAFF_PERMISSION_MODULES
    .filter(({key, permissionMode}) => permissionMode !== 'editOnly'
      && ownData(ownData(normalized, key), 'view') === true)
    .map(({key}) => key);
}
