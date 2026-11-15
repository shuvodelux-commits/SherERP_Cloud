/**
 * Internal M03 port of frozen Utils.gs::safeDateOnly_ and formatDate_.
 *
 * Apps Script uses Session.getScriptTimeZone(); Workerd has no equivalent.
 * The caller must supply a trusted business IANA zone, never user input.
 * Falsy inputs and invalid-date fallback retain the original source shape.
 *
 * No D1, RPC, GAS services, mutable cache or default timezone.
 */
export function safeSourceDateOnly(value,timeZone){
  if(!value)return '';
  if(typeof timeZone!=='string'||!timeZone.trim())
    throw new TypeError('Explicit business timeZone required');

  // Construct outside the source parse fallback: invalid timezone metadata
  // is a configuration error, not an invalid legacy date cell.
  const formatter=new Intl.DateTimeFormat('en-GB',{
    timeZone:timeZone.trim(),year:'numeric',month:'2-digit',day:'2-digit'
  });
  try{
    const parts=formatter.formatToParts(new Date(value));
    const part=key=>parts.find(item=>item.type===key)?.value;
    return [part('year'),part('month'),part('day')].join('-');
  }catch{
    return String(value).slice(0,10);
  }
}
