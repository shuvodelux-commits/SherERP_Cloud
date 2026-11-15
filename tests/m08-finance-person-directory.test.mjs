import test from 'node:test';
import assert from 'node:assert/strict';
import {projectFinancePersonDirectory} from '../src/modules/m08-finance-person-directory.js';
import {loadPinnedGASFunctions} from './fixtures/m08-legacy-source-runner.mjs';

const copy=value=>JSON.parse(JSON.stringify(value));
const person=(id,name,extra={})=>({
  'Person ID':id,'Person Name':name,'Person Type':'Owner',
  'Roles':'Owner','Status':'Active', ...extra
});

// Exact unmodified function declarations from frozen FinanceModule.gs are
// executed inside test-only VM. This oracle has no GAS runtime or live data.
function original(rows,{activeOnly=false}={}){
  const fx=loadPinnedGASFunctions({
    'FinanceModule.gs':[
      'financeCanonicalRoles_','financePersonRoles_',
      'getAllFinancePersonsForUI_','getActiveFinancePersonsForUI_'
    ]
  },{
    FINANCE_PERSON_ROLES:['Owner','Lender','Borrower'],
    getAllRows_:table=>{
      assert.equal(table,'FINANCE_PERSONS');
      return copy(rows);
    }
  });
  return copy(activeOnly ? fx.getActiveFinancePersonsForUI_() :
    fx.getAllFinancePersonsForUI_());
}
function parity(rows,options={}){
  const result=projectFinancePersonDirectory(rows,options);
  assert.deepEqual(result,original(rows,options));
  return result;
}

test('one original Finance Person ID retains all three canonical Owner/Lender/Borrower roles in source order',()=>{
  const result=parity([person('FP-01','Nasir',{
    'Person Type':'Lender','Roles':'Borrower,Owner,Lender,Owner'
  })]);
  assert.deepEqual(result,[{
    id:'FP-01',name:'Nasir',type:'Lender',
    roles:['Owner','Lender','Borrower'],
    status:'Active',phone:'',description:''
  }]);
});

test('finance roles are additive: duplicate and unrecognized tokens do not create extra master rows',()=>{
  const result=parity([person('FP-02','Laila',{
    Roles:'junk, Borrower, Borrower, Lender, wrong'
  })]);
  assert.equal(result.length,1);
  assert.deepEqual(result[0].roles,['Lender','Borrower']);
});

test('legacy Person Type is used if Roles is blank or contains only unsupported values',()=>{
  const records=[
    person('F-A','Legacy Lender',{'Person Type':'Lender','Roles':''}),
    person('F-B','Legacy Borrower',{'Person Type':'Borrower','Roles':'Vendor,Admin'})
  ];
  const result=parity(records);
  assert.deepEqual(result.map(p=>p.roles),[['Lender'],['Borrower']]);
  assert.deepEqual(result.map(p=>p.type),['Lender','Borrower']);
});

test('unknown old Type falls back to Owner role, but original nonempty raw Type remains source presentation',()=>{
  const result=parity([person('FP-99','Unclassified',{
    'Person Type':'Investor','Roles':'something'
  })]);
  assert.deepEqual(result[0].roles,['Owner']);
  assert.equal(result[0].type,'Investor');
});

test('source supports Roles as a source-loaded array and non-Owner canonical ordering',()=>{
  const result=parity([person('FP-12','Multi',{
    'Person Type':'','Roles':['Borrower','Owner','Lender']
  })]);
  assert.deepEqual(result[0].roles,['Owner','Lender','Borrower']);
  assert.equal(result[0].type,'Owner');
});

test('All Finance Persons include inactive records but active-only removes exactly Inactive',()=>{
  const rows=[
    person('F1','Active Person'),
    person('F2','Inactive Person',{'Status':'Inactive'}),
    person('F3','Legacy Status',{'Status':''}),
    person('F4','Lowercase Status',{'Status':'inactive'})
  ];
  const all=parity(rows);
  assert.deepEqual(all.map(p=>p.status),['Active','Inactive','Active','inactive']);
  const active=parity(rows,{activeOnly:true});
  assert.deepEqual(active.map(p=>p.id),['F1','F3','F4']);
  assert.ok(active.every(p=>!Object.hasOwn(p,'status')));
});

test('same name and phone with distinct verified original IDs remain distinct; never merge by display',()=>{
  const rows=[
    person('P-100','Same Name',{'Phone':'01700000000','Roles':'Owner'}),
    person('P-101','Same Name',{'Phone':'01700000000','Roles':'Lender'})
  ];
  const result=parity(rows);
  assert.deepEqual(result.map(p=>p.id),['P-100','P-101']);
  assert.deepEqual(result.map(p=>p.roles),[['Owner'],['Lender']]);
});

test('source notes/description/phone fallback and active dropdown metadata remain exact',()=>{
  const rows=[
    person('F-1','Notes First',{'Description':'','Notes':'from legacy','Phone':'01712345678'}),
    person('F-2','Description Wins',{'Description':'new details','Notes':'old details','Phone':''})
  ];
  const all=parity(rows);
  assert.deepEqual(all.map(p=>p.description),['from legacy','new details']);
  const active=parity(rows,{activeOnly:true});
  assert.deepEqual(active[0],{
    id:'F-1',name:'Notes First',type:'Owner',roles:['Owner'],
    phone:'01712345678',description:'from legacy'
  });
});

test('empty directory returns empty results and frozen inputs retain original order and fields',()=>{
  assert.deepEqual(parity([]),[]);
  assert.deepEqual(parity([],{activeOnly:true}),[]);
  const p1=Object.freeze(person('FP-1','One',{'Roles':'Lender,Owner'}));
  const p2=Object.freeze(person('FP-2','Two',{'Status':'Inactive'}));
  const rows=Object.freeze([p1,p2]);
  const snapshot=copy(rows);
  const result=parity(rows);
  assert.deepEqual(result.map(x=>x.id),['FP-1','FP-2']);
  assert.deepEqual(rows,snapshot);
});

test('invalid unlinked source IDs, duplicate original IDs, missing names and unloaded inputs fail closed',()=>{
  const valid=person('F1','Person');
  assert.throws(()=>projectFinancePersonDirectory(Promise.resolve([valid])),TypeError);
  assert.throws(()=>projectFinancePersonDirectory(null),TypeError);
  assert.throws(()=>projectFinancePersonDirectory({rows:[valid]}),TypeError);
  assert.throws(()=>projectFinancePersonDirectory([null]),TypeError);
  assert.throws(()=>projectFinancePersonDirectory([person('','Nameless ID')]),TypeError);
  assert.throws(()=>projectFinancePersonDirectory([person('  ','Whitespace ID')]),TypeError);
  assert.throws(()=>projectFinancePersonDirectory([valid,person('F1','Other')]),TypeError);
  assert.throws(()=>projectFinancePersonDirectory([person(123,'Numeric ID')]),TypeError);
  assert.throws(()=>projectFinancePersonDirectory([person('F2','')]),TypeError);
  assert.throws(()=>projectFinancePersonDirectory([person('F2',null)]),TypeError);
  assert.throws(()=>projectFinancePersonDirectory([valid],{activeOnly:'false'}),TypeError);
  assert.throws(()=>projectFinancePersonDirectory([valid],Promise.resolve({activeOnly:true})),TypeError);
});
