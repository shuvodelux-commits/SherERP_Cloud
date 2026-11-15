/**
 * Internal-only M04 staff phone normalization from pinned GAS Utils.gs.
 * Phone equivalence is NOT a Party/Customer/Supplier identity link.
 *
 * These source-compatible helpers are not public login or authorization.
 */
const TEN_DIGIT_BD_MOBILE=/^1[3-9]\d{8}$/;
const INTERNATIONAL_BD_MOBILE=/^8801[3-9]\d{8}$/;
const BANGLA_DIGITS='০১২৩৪৫৬৭৮৯';

export function normalizeLegacyStaffPhoneDisplay(value) {
  const text=value===null || value===undefined ? '' : String(value).trim();
  return TEN_DIGIT_BD_MOBILE.test(text) ? '0'+text : text;
}

export function normalizeLegacyStaffPhoneSearch(value) {
  const display=normalizeLegacyStaffPhoneDisplay(value);
  const asciiText=String(display || '').replace(/[০-৯]/g,digit=>
    String(BANGLA_DIGITS.indexOf(digit)));
  let digits=asciiText.replace(/\D/g,'');
  if(INTERNATIONAL_BD_MOBILE.test(digits)) digits='0'+digits.slice(3);
  else if(TEN_DIGIT_BD_MOBILE.test(digits)) digits='0'+digits;
  return digits;
}

export function legacyStaffPhonesEqual(a,b) {
  const left=normalizeLegacyStaffPhoneSearch(a);
  const right=normalizeLegacyStaffPhoneSearch(b);
  return !!left && !!right && left===right;
}

const noMatch = ()=>({status:'none',index:null});
const invalidRecord = ()=>({status:'invalid-record',index:null});

/**
 * Find whether ONE staff record has the matching source-normalized phone.
 * The roster must be a successfully loaded complete server-side snapshot.
 * Caller MUST NOT authorize based on this result alone: verify password,
 * identity, account active/role policy, throttle and session in trusted D1.
 * Phone matches must never merge Party identities.
 */
export function findUniqueLegacyStaffPhone(users,input) {
  if(!Array.isArray(users)) return invalidRecord();
  let lookup;
  let matchedIndex=null;
  let matchedCount=0;

  try {
    lookup=normalizeLegacyStaffPhoneSearch(input);

    // Inspect the complete server-loaded roster even after finding a match:
    // source first-match behavior must not silently select duplicate users.
    for(let i=0;i<users.length;i++){
      const record=users[i];
      if(record===null || typeof record!=='object' || Array.isArray(record))
        return invalidRecord();
      const descriptor=Object.getOwnPropertyDescriptor(record,'Mobile Number');
      if(!descriptor || !Object.hasOwn(descriptor,'value'))
        return invalidRecord();
      const mobile=descriptor.value;
      if(mobile!==null && mobile!==undefined &&
          typeof mobile!=='string' && typeof mobile!=='number')
        return invalidRecord();
      if(lookup && legacyStaffPhonesEqual(mobile,lookup)){
        matchedIndex=i;
        matchedCount++;
      }
    }
  } catch {
    // Proxies, unexpected coercions or corrupted imported rows deny lookup.
    return invalidRecord();
  }

  if(matchedCount===0) return noMatch();
  return matchedCount===1
    ? {status:'unique',index:matchedIndex}
    : {status:'ambiguous',index:null};
}
