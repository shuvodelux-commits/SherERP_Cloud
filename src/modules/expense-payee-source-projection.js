/**
 * M03 internal, source-only Expense Payees contract.
 *
 * This is NOT a D1 payee master read/import and NOT an authenticated RPC.
 * M02-P owns approved Party identities; original Payee IDs, soft deletion
 * metadata and physical source rows must survive before M02 builds a
 * reviewed payee master schema. Never infer a Party link from name or phone.
 *
 * Frozen Mohim_ERP source:
 * Config.gs::HEADERS.EXPENSE_PAYEES, Database.gs::getAllRows_,
 * DeleteEngine.gs::activeRows_/isDeleted_,
 * ExpenseSettings.gs::getExpensePayeesManagement,
 * Expense.gs::getExpensePayeesForUI_.
 */
const HEADERS=Object.freeze([
  'Payee ID','Payee Name','Phone','Notes','Status','Created At',
  'Is Deleted','Deleted By','Deleted At','Delete Reason'
]);
const REQUIRED=Object.freeze([...HEADERS,'_rowIndex']);
const MAX_ROWS=1000;

function invalid(){
  // Never include source ID, phone, audit actor, payment data or exceptions.
  return new Error('Invalid EXPENSE_PAYEES source snapshot');
}
function validDeletionMarker(v){
  return typeof v==='boolean' ||
    (typeof v==='string' && (v==='' ||
      v.toUpperCase()==='TRUE' || v.toUpperCase()==='FALSE'));
}

/**
 * Validate a *complete* already-exported source group before any projection.
 * The original Sheet row number is immutable provenance; do not replace it
 * with Party IDs or sort/delete physical source records.
 */
export function prepareExpensePayeeSnapshot(sourceRows){
  try{
    if(!Array.isArray(sourceRows) ||
       Object.getPrototypeOf(sourceRows)!==Array.prototype ||
       sourceRows.length>MAX_ROWS ||
       Reflect.ownKeys(sourceRows).length!==sourceRows.length+1)
      throw invalid();

    const ids=new Set(),out=[];
    for(let i=0;i<sourceRows.length;i++){
      const element=Object.getOwnPropertyDescriptor(sourceRows,String(i));
      if(!element?.enumerable || !Object.hasOwn(element,'value'))
        throw invalid();
      const raw=element.value;
      if(raw===null || typeof raw!=='object' || Array.isArray(raw) ||
         Object.getPrototypeOf(raw)!==Object.prototype)
        throw invalid();

      const descriptors=Object.getOwnPropertyDescriptors(raw);
      const keys=Reflect.ownKeys(descriptors);
      if(keys.length!==REQUIRED.length ||
         keys.some(key=>typeof key!=='string'||!REQUIRED.includes(key)) ||
         !REQUIRED.every(key=>descriptors[key]?.enumerable===true &&
           Object.hasOwn(descriptors[key],'value')))
        throw invalid();

      const value=key=>descriptors[key].value;
      const id=value('Payee ID'),name=value('Payee Name');
      if(!Number.isSafeInteger(value('_rowIndex')) ||
         value('_rowIndex')!==i+2 ||
         typeof id!=='string' || !id.trim() || ids.has(id) ||
         typeof name!=='string' || !name.trim() ||
         !HEADERS.filter(key=>key!=='Is Deleted')
           .every(key=>typeof value(key)==='string') ||
         !['Active','Inactive',''].includes(value('Status')) ||
         !validDeletionMarker(value('Is Deleted')))
        throw invalid();

      ids.add(id);
      const copy=Object.fromEntries(HEADERS.map(key=>[key,value(key)]));
      copy._rowIndex=i+2;
      out.push(copy);
    }
    return out;
  }catch{
    throw invalid();
  }
}

// DeleteEngine.gs::isDeleted_: true OR uppercase textual 'TRUE' only.
// This is deliberately separate from the source's inactive Status flag.
function isDeleted(row){
  const value=row['Is Deleted'];
  return value===true || String(value||'').toUpperCase()==='TRUE';
}
function byName(a,b){
  return String(a.name).localeCompare(String(b.name));
}

/**
 * All four projections are private copies. Caller must enforce expense.view
 * before ever returning selected data through a future HTTP adapter.
 *
 * settingsPayees = original activeRows_ (soft-deleted excluded, inactive kept).
 * activeUiPayees = Expense.gs active dropdown (inactive also excluded).
 * managementPayees = ExpenseSettings.gs nondeleted management list.
 */
export function projectExpensePayeeViews(sourceRows){
  const allRows=prepareExpensePayeeSnapshot(sourceRows);
  const settingsPayees=allRows.filter(row=>!isDeleted(row)).map(row=>({...row}));
  const activeUiPayees=settingsPayees
    .filter(row=>row.Status!=='Inactive')
    .map(row=>({id:row['Payee ID'],name:row['Payee Name'],phone:row.Phone||''}))
    .sort(byName);
  const managementPayees=settingsPayees
    .map(row=>({
      id:row['Payee ID'],name:row['Payee Name'],phone:row.Phone||'',
      notes:row.Notes||'',status:row.Status==='Inactive'?'Inactive':'Active'
    }))
    .sort(byName);
  return {allRows,settingsPayees,activeUiPayees,managementPayees};
}
