/**
 * Internal M03 port of frozen Utils.gs::safeTimeOnly_.
 *
 * Source strings are wall-clock text, not instants: preserve the embedded
 * time even when Sheets serialized a time-only cell with 1899-12-30.
 * Genuine Date objects require an explicit trusted business IANA timezone
 * because Cloudflare Workers have no Apps Script Session timezone.
 *
 * No D1, RPC, mutation or module-level request cache.
 */
export function safeSourceTimeOnly(value,timeZone){
  if(!value)return '';

  if(Object.prototype.toString.call(value)==='[object Date]'){
    if(typeof timeZone!=='string'||!timeZone.trim()){
      throw new TypeError('Explicit business timeZone required for Date');
    }
    const formatter=new Intl.DateTimeFormat('en-GB',{
      timeZone,hour:'2-digit',minute:'2-digit',second:'2-digit',
      hourCycle:'h23',
    });
    const parts=formatter.formatToParts(value);
    return ['hour','minute','second'].map(type=>
      parts.find(part=>part.type===type).value).join(':');
  }

  const text=String(value).trim();
  const iso=text.match(/T(\d{2}:\d{2}:\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?$/);
  if(iso)return iso[1];
  const plain=text.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if(plain)return String(plain[1]).padStart(2,'0')+':'+plain[2]+':'+(plain[3]||'00');
  return text;
}
