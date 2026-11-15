/**
 * M09 INTERNAL source-validated Shell Settings save.
 *
 * Only Shop Name and Currency Symbol on isolated, single-business D1.
 * Frozen Settings.gs source preflight is reused; M04 enforces current
 * settings.edit permission and old-value CAS in the SAME SQL mutation.
 * NOT a public RPC, all-30-key updater, multi-tenant endpoint, or preview.
 */
import {planSettingsUpdate} from './settings-update-preflight.js';
import {createM04AuthorizedShellSettingsUpdateAdapter}
  from '../db/m04-settings-update.js';

const ALLOWED=new Set(['Shop Name','Currency Symbol']);
const FIELDS=['token','nowMs','key','newValue','expectedValue'];

function validated(request){
  if(request===null || typeof request!=='object' ||
    Array.isArray(request) ||
    (Object.getPrototypeOf(request)!==Object.prototype &&
     Object.getPrototypeOf(request)!==null))
    throw new TypeError('Invalid Settings save request object');
  const keys=Reflect.ownKeys(request);
  if(keys.length!==FIELDS.length ||
    keys.some(key=>typeof key!=='string' || !FIELDS.includes(key)))
    throw new TypeError('Invalid Settings save request fields');
  const input={};
  for(const key of FIELDS){
    const descriptor=Object.getOwnPropertyDescriptor(request,key);
    if(!descriptor || !descriptor.enumerable ||
      !Object.hasOwn(descriptor,'value'))
      throw new TypeError('Invalid Settings save request accessor or descriptor');
    input[key]=descriptor.value;
  }
  if(typeof input.key!=='string' || !ALLOWED.has(input.key) ||
     typeof input.newValue!=='string' ||
     typeof input.expectedValue!=='string')
    throw new TypeError('Invalid or unsupported Shell Settings key or values');
  // M04 independently validates token/time against current session policy.
  return input;
}

/**
 * Returns the original source envelope only AFTER the M04 guarded D1 CAS.
 * A source validation failure returns an error without opening a D1 query;
 * denied/stale/uncertain SQL outcomes are never converted to success.
 */
export function createM09AuthorizedShellSettingsSave(env){
  const authorized=createM04AuthorizedShellSettingsUpdateAdapter(env);
  return Object.freeze({
    async saveOne(request){
      const input=validated(request);
      const plan=planSettingsUpdate({[input.key]:input.newValue});
      if(!plan.success)return {success:false,error:plan.error};
      if(plan.writes.length!==1 || plan.writes[0].key!==input.key ||
          typeof plan.writes[0].value!=='string')
        throw new Error('NEEDS_REVIEW: invalid single Settings proposal');
      await authorized.updateExisting_({
        token:input.token,nowMs:input.nowMs,
        key:input.key,newValue:plan.writes[0].value,
        expectedValue:input.expectedValue
      });
      return {success:true,data:'Settings saved.'};
    }
  });
}
