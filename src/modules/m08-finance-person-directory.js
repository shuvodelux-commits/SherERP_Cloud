/**
 * M08 internal, read-only Finance Person directory projection.
 *
 * Source parity: frozen FinanceModule.gs financePersonRoles_ and
 * getAllFinancePersonsForUI_ / getActiveFinancePersonsForUI_.
 * Pinned Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2.
 *
 * Not a finance posting, D1 repository, RPC, permission decision or
 * Party identity linker. Caller provides already-loaded source master rows.
 */
const ROLE_ORDER=['Owner','Lender','Borrower'];

function financeRoles(row) {
  const input=Array.isArray(row['Roles'])
    ? row['Roles']
    : String(row['Roles']||'').split(',');
  const canonical=ROLE_ORDER.filter(role=>
    input.some(value=>String(value||'').trim()===role));
  if(canonical.length)return canonical;
  const oldType=String(row['Person Type']||'').trim();
  return ROLE_ORDER.includes(oldType)?[oldType]:['Owner'];
}

/**
 * @param {Array<Record<string,unknown>>} rawRows - already loaded FINANCE_PERSONS
 * @param {{activeOnly?:boolean}} options - source's active-only dropdown shape
 * @returns {Array<object>} one immutable-identity record per original Person ID
 */
export function projectFinancePersonDirectory(rawRows,options={}) {
  if(!Array.isArray(rawRows))
    throw new TypeError('Finance Person rows must be a loaded array');
  if(!options || typeof options!=='object' || Array.isArray(options) ||
     typeof options.then==='function' ||
     (options.activeOnly!==undefined && typeof options.activeOnly!=='boolean'))
    throw new TypeError('Invalid Finance Person directory options');

  const ids=new Set();
  for(const row of rawRows) {
    if(!row || typeof row!=='object' || Array.isArray(row) ||
       typeof row['Person ID']!=='string' || !row['Person ID'].trim() ||
       typeof row['Person Name']!=='string' || !row['Person Name'].trim())
      throw new TypeError('Finance Person must have an original ID and name');
    if(ids.has(row['Person ID']))
      throw new TypeError('Duplicate original Finance Person ID');
    ids.add(row['Person ID']);
  }

  const all=rawRows.map(row=>{
    const roles=financeRoles(row);
    return {
      id:row['Person ID'],
      name:row['Person Name'],
      type:row['Person Type']||roles[0]||'Owner',
      roles,
      status:row['Status']||'Active',
      phone:row['Phone']||'',
      description:row['Description']||row['Notes']||''
    };
  });
  if(!options.activeOnly)return all;
  return all.filter(row=>row.status!=='Inactive').map(row=>({
    id:row.id,
    name:row.name,
    type:row.type,
    roles:row.roles,
    phone:row.phone,
    description:row.description||''
  }));
}
