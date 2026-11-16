import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  prepareExpensePayeeSnapshot,projectExpensePayeeViews
} from '../src/modules/expense-payee-source-projection.js';

const COLUMNS=[
  'Payee ID','Payee Name','Phone','Notes','Status','Created At',
  'Is Deleted','Deleted By','Deleted At','Delete Reason'
];
const payee=(id,name,phone,position,patch={})=>({
  'Payee ID':id,'Payee Name':name,Phone:phone,Notes:'',
  Status:'Active','Created At':'2026-11-14T11:00:00',
  'Is Deleted':'','Deleted By':'','Deleted At':'','Delete Reason':'',
  _rowIndex:position,...patch
});
const source=()=>[
  payee('PAY-A','দোকান ভাড়া','01700000000',2),
  payee('PAY-B','দোকান ভাড়া','01700000000',3,
    {Notes:'  shared name/phone; DIFFERENT ID  ',Status:'Inactive'}),
  payee('PAY-C','মোঃ আলী','',4,{Status:'',Notes:'payee note'}),
  payee('PAY-D','Deleted Name','01800000000',5,{
    'Is Deleted':'TRUE','Deleted By':'Reviewer A',
    'Deleted At':'2026-11-15T12:00:00','Delete Reason':'Duplicate created in error'
  })
];

test('frozen source contains all ten Payee headers and distinct original view semantics',()=>{
  const config=readFileSync(new URL('../legacy/source/Config.gs',import.meta.url),'utf8');
  const begin=config.indexOf('    EXPENSE_PAYEES: [');
  assert(begin>=0);
  const src=config.slice(begin,config.indexOf('    ],',begin)+6);
  assert.deepEqual([...src.matchAll(/"([^"]+)"/g)].map(m=>m[1]),COLUMNS);
  const sourceCode=readFileSync(new URL('../legacy/source/ExpenseSettings.gs',import.meta.url),'utf8');
  const expenseCode=readFileSync(new URL('../legacy/source/Expense.gs',import.meta.url),'utf8');
  const deletionCode=readFileSync(new URL('../legacy/source/DeleteEngine.gs',import.meta.url),'utf8');
  assert.match(sourceCode,/getExpensePayeesManagement\(token\)/);
  assert.match(sourceCode,/activeRows_\('EXPENSE_PAYEES'\)/);
  assert.match(expenseCode,/getExpensePayeesForUI_\(\)/);
  assert.match(expenseCode,/p\['Status'\] !== 'Inactive'/);
  assert.match(deletionCode,/String\(v \|\| ''\)\.toUpperCase\(\) === 'TRUE'/);
});

test('full snapshot keeps original Payee ID, UTF-8 phone, order, ten keys, tombstones and physical rows',()=>{
  const input=source(),before=structuredClone(input);
  const output=prepareExpensePayeeSnapshot(input);
  assert.deepEqual(output,input);
  assert.deepEqual(input,before);
  assert.deepEqual(Object.keys(output[0]),[...COLUMNS,'_rowIndex']);
  assert.deepEqual(output.map(x=>x._rowIndex),[2,3,4,5]);
  assert.equal(output[0].Phone,'01700000000');
  assert.equal(output[1]['Payee Name'],output[0]['Payee Name']);
  assert.equal(output[3]['Delete Reason'],'Duplicate created in error');
  assert.notStrictEqual(output,input);
  assert.notStrictEqual(output[0],input[0]);
  output[0].Phone='CLIENT_MUTATION';
  assert.equal(input[0].Phone,'01700000000');
  assert.deepEqual(prepareExpensePayeeSnapshot([]),[]);
});

test('Settings, dropdown, and management projections preserve source-specific deleted/inactive rules',()=>{
  const src=source(),before=structuredClone(src);
  const views=projectExpensePayeeViews(src);
  assert.deepEqual(views.allRows,src);
  assert.deepEqual(views.settingsPayees,src.slice(0,3),
    'Settings gets full nondeleted rows, not active-only dropdown');
  assert.deepEqual(views.activeUiPayees,[
    {id:'PAY-A',name:'দোকান ভাড়া',phone:'01700000000'},
    {id:'PAY-C',name:'মোঃ আলী',phone:''}
  ].sort((a,b)=>String(a.name).localeCompare(String(b.name))));
  assert.deepEqual(views.managementPayees,[
    {id:'PAY-A',name:'দোকান ভাড়া',phone:'01700000000',notes:'',status:'Active'},
    {id:'PAY-B',name:'দোকান ভাড়া',phone:'01700000000',
      notes:'  shared name/phone; DIFFERENT ID  ',status:'Inactive'},
    {id:'PAY-C',name:'মোঃ আলী',phone:'',notes:'payee note',status:'Active'}
  ].sort((a,b)=>String(a.name).localeCompare(String(b.name))));
  assert.deepEqual(src,before);
  views.settingsPayees[0]['Payee Name']='X';
  views.allRows[0]['Payee Name']='Y';
  assert.equal(src[0]['Payee Name'],'দোকান ভাড়া');
  assert.equal(views.activeUiPayees.find(x=>x.id==='PAY-A').name,'দোকান ভাড়া',
    'different projections must not alias same object');
});

test('DeleteEngine boolean true and case-insensitive TRUE strings remain hidden; false remains visible',()=>{
  for(const mark of [true,'TRUE','true','TrUe']){
    const src=[payee('PAY-D','D','',2,{'Is Deleted':mark})];
    const v=projectExpensePayeeViews(src);
    assert.equal(v.allRows.length,1);
    assert.deepEqual(v.settingsPayees,[]);
    assert.deepEqual(v.activeUiPayees,[]);
    assert.deepEqual(v.managementPayees,[]);
    assert.equal(v.allRows[0]['Is Deleted'],mark);
  }
  for(const mark of ['',false,'FALSE','false','FaLsE']){
    const v=projectExpensePayeeViews([payee('PAY-A','A','',2,{'Is Deleted':mark})]);
    assert.equal(v.settingsPayees.length,1);
    assert.equal(v.activeUiPayees.length,1);
  }
});

test('duplicate name or phone does not merge source payee identities',()=>{
  const v=projectExpensePayeeViews([
    payee('PAY-01','Same Name','01612345678',2),
    payee('PAY-02','Same Name','01612345678',3)
  ]);
  assert.deepEqual(v.allRows.map(x=>x['Payee ID']),['PAY-01','PAY-02']);
  assert.deepEqual(v.activeUiPayees.map(x=>x.id),['PAY-01','PAY-02']);
  assert.deepEqual(v.managementPayees.map(x=>x.id),['PAY-01','PAY-02']);
  assert.equal(Object.hasOwn(v.activeUiPayees[0],'partyId'),false);
  assert.equal(Object.hasOwn(v.managementPayees[0],'balance'),false);
});

test('complete snapshot rejects source row deletion/gaps, changed IDs, extra keys, accessors, symbols and phone numbers',()=>{
  const sample=source();
  const variants=[
    [sample[1],sample[0],sample[2],sample[3]],
    sample.map((x,i)=>i===2?{...x,_rowIndex:7}:x),
    sample.map((x,i)=>i===2?{...x,_rowIndex:Number.MAX_SAFE_INTEGER+1}:x),
    sample.map((x,i)=>i===1?{...x,'Payee ID':'PAY-A'}:x),
    sample.map((x,i)=>i===1?{...x,'Payee ID':' '} :x),
    sample.map((x,i)=>i===1?{...x,'Payee Name':''} :x),
    sample.map((x,i)=>i===1?{...x,Phone:1712345678} :x),
    sample.map((x,i)=>i===1?{...x,Status:'unknown'}:x),
    sample.map((x,i)=>i===1?{...x,'Is Deleted':'DELETED'}:x),
    sample.map((x,i)=>i===1?{...x,'Deleted By':null}:x),
    sample.map((x,i)=>i===1?{...x,'Unknown Internal':true}:x),
    sample.map((x,i)=>i===1?Object.fromEntries(Object.entries(x).filter(([k])=>k!=='Notes')):x),
    [payee('PAY-01','Valid','',2,{'Created At':new Date()})]
  ];
  for(const rows of variants){
    assert.throws(()=>prepareExpensePayeeSnapshot(rows),/invalid|unsafe|source|row/i);
  }
  const accessor=source();
  Object.defineProperty(accessor[0],'Phone',{enumerable:true,get(){throw Error('PRIVATE_PHONE_01799999999');}});
  let error;
  try{prepareExpensePayeeSnapshot(accessor);}catch(e){error=e;}
  assert.ok(error instanceof Error);
  assert.doesNotMatch(String(error),/PRIVATE_PHONE|01799999999/);
  const proto=source();
  Object.setPrototypeOf(proto[0],{});
  assert.throws(()=>prepareExpensePayeeSnapshot(proto),/invalid|source/i);
  const symbol=source();
  symbol[0][Symbol('private')]='hidden';
  assert.throws(()=>prepareExpensePayeeSnapshot(symbol),/invalid|source/i);
});

test('source list is fully validated before any projection, including last row and max 1000 cap',()=>{
  const rows=Array.from({length:1001},(_,i)=>payee('PAY-'+i,'Name '+i,'',i+2));
  assert.throws(()=>projectExpensePayeeViews(rows),/limit|1000|source/i);
  const damaged=source();
  damaged[3]['Payee ID']='PAY-A';
  assert.throws(()=>projectExpensePayeeViews(damaged),/duplicate|source|invalid/i);
  assert.deepEqual(projectExpensePayeeViews([]),{
    allRows:[],settingsPayees:[],activeUiPayees:[],managementPayees:[]
  });
});
