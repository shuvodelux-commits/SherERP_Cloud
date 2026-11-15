/**
 * M04 internal source-shaped safety preflight for sensitive staff mutations.
 *
 * A decision of ALLOWED does NOT authorize a request. Real handlers must
 * validate server-backed actor sessions, operation RBAC and role membership,
 * enforce constraints in atomic D1 writes, then revoke affected sessions.
 * Never accept browser-provided snapshots or active Administrator counts.
 */

const INVALID=Object.freeze({allowed:false,code:'INVALID_CONTEXT'});
const ALLOWED=Object.freeze({allowed:true,code:'ALLOWED'});
const denied=code=>({allowed:false,code});
const operations=new Set(['delete','set-status','set-role','reset-password']);
const validStatus=value=>value==='Active' || value==='Inactive';
const filled=value=>typeof value==='string' && value.trim().length>0;

function ownValues(object,required) {
  if(!object || typeof object!=='object' || Array.isArray(object)) return null;
  const prototype=Object.getPrototypeOf(object);
  if(prototype!==Object.prototype && prototype!==null) return null;
  const values=Object.create(null);
  for(const name of required) {
    const descriptor=Object.getOwnPropertyDescriptor(object,name);
    if(!descriptor || !Object.hasOwn(descriptor,'value')) return null;
    values[name]=descriptor.value;
  }
  return values;
}

function readStaff(record) {
  const values=ownValues(record,['User ID','Role','Status']);
  return values && filled(values['User ID']) && filled(values.Role) &&
      validStatus(values.Status) ? values : null;
}

/**
 * @param {unknown} context - server-derived actor, target, operation,
 *   activeAdministratorCount and operation-specific next value
 * @returns {{allowed:boolean,code:string}} fixed-code preflight only
 */
export function evaluateStaffMutationGuard(context) {
  try {
    const base=ownValues(context,[
      'operation','actor','target','activeAdministratorCount',
    ]);
    if(!base || !operations.has(base.operation)) return {...INVALID};

    const required=['operation','actor','target','activeAdministratorCount'];
    if(base.operation==='set-role') required.push('nextRole');
    if(base.operation==='set-status') required.push('nextStatus');
    const expected=new Set(required);
    const keys=Reflect.ownKeys(context);
    // A missing field is rejected by ownValues; unexpected/secret/client
    // override fields are rejected rather than silently ignored.
    if(keys.length!==required.length || keys.some(key=>!expected.has(key)))
      return {...INVALID};

    const full=ownValues(context,required);
    const actor=readStaff(base.actor);
    const target=readStaff(base.target);
    const count=base.activeAdministratorCount;

    if(!full || !actor || !target ||
       !Number.isSafeInteger(count) || count<1)
      return {...INVALID};
    if(base.operation==='set-role' && !filled(full.nextRole))
      return {...INVALID};
    if(base.operation==='set-status' && !validStatus(full.nextStatus))
      return {...INVALID};

    if(actor.Status!=='Active') return denied('ACTOR_INACTIVE');

    if(base.operation==='delete') {
      if(actor['User ID']===target['User ID'])
        return denied('SELF_DELETE_FORBIDDEN');
      if(target.Role==='Administrator' && count<=1)
        return denied('LAST_ADMIN_FORBIDDEN');
    }

    if(base.operation==='set-status' &&
       full.nextStatus==='Inactive' &&
       target.Role==='Administrator' && count<=1)
      return denied('LAST_ADMIN_FORBIDDEN');

    if(base.operation==='set-role') {
      if(target.Role==='Administrator' && full.nextRole!=='Administrator' && count<=1)
        return denied('LAST_ADMIN_FORBIDDEN');
      if(full.nextRole==='Administrator' && actor.Role!=='Administrator')
        return denied('ADMIN_ROLE_REQUIRES_ADMIN');
    }

    if(base.operation==='reset-password' &&
       target.Role==='Administrator' && actor.Role!=='Administrator')
      return denied('ADMIN_RESET_REQUIRES_ADMIN');

    return {...ALLOWED};
  } catch {
    // Getters/Proxies and any corrupted server records cannot grant access.
    return {...INVALID};
  }
}
