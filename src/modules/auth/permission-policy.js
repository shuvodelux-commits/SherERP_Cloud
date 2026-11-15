/**
 * Internal M04 policy preparation. NOT registered as a Worker RPC handler.
 * This is a strict, JSON-safe port of RoleManagement.gs::sanitizePermissions_.
 * Source vocabulary: UI.gs::PERMISSION_MODULES / Auth.gs::DELETE_WINDOW_OPTIONS.
 * No session, D1 or client actor is trusted here.
 */
export const STAFF_PERMISSION_MODULES = Object.freeze([
  {key:'dashboard'}, {key:'pos'}, {key:'sales'}, {key:'returns'},
  {key:'purchase'}, {key:'suppliers'}, {key:'vendors'}, {key:'products'},
  {key:'customers'}, {key:'bank'}, {key:'expense'}, {key:'finance'},
  {key:'daybook'}, {key:'cashReconciliation'}, {key:'reports'},
  {key:'settings'}, {key:'users'}, {key:'roles'},
  {key:'openingBalance', permissionMode:'editOnly'},
  {key:'settlementDiscount', permissionMode:'editOnly'},
  {key:'posCost'},
].map((entry) => Object.freeze(entry)));

export const PERMISSION_WINDOW_CODES = Object.freeze([
  'disabled','same','1','3','7','15','30','unlimited',
]);

const windows = new Set(PERMISSION_WINDOW_CODES);
const management = new Set(['users','roles']);

function ownData(object, key) {
  if (object === null || typeof object !== 'object') return undefined;
  // Accessor properties and inherited values must not grant permission.
  const descriptor = Object.getOwnPropertyDescriptor(object, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
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
