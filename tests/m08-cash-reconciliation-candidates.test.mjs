import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCashReconciliationCandidates} from '../src/modules/m08-cash-reconciliation-candidates.js';
import {loadPinnedGASFunctions} from './fixtures/m08-legacy-source-runner.mjs';

const timeZone='Asia/Dhaka';
const plain=value=>JSON.parse(JSON.stringify(value));
const session=(id,status='Closed',openedAt='2026-11-16T09:00:00+06:00',fields={})=>({
  'Session ID':id,'Status':status,'Opened At':openedAt,'Opening Cash':100,
  'Expected Cash':100,'Counted Cash':130,'Variance':'',
  'Opening Explanation Entry IDs':'','Closing Explanation Entry IDs':'',...fields
});
const cash=(id,credit='',debit='',fields={})=>({
  'Entry ID':id,'Date':'2026-11-16T10:00:00+06:00',
  'Credit':credit,'Debit':debit,'Type':'Sale','Reference':'INV-1',
  'Description':'cash receipt','Is Deleted':'',...fields
});

function sourceResult(sessions,entries,{sessionId='target',phase='closing',query='' }={}) {
  const source=loadPinnedGASFunctions({
    'Utils.gs':['roundMoney_','formatDate_','safeDateOnly_'],
    'CashReconciliation.gs':[
      'cashReconciliationSigned_','cashReconciliationIsDeleted_',
      'cashReconciliationIsSynthetic_','cashReconciliationParseIds_',
      'cashReconciliationExplanationField_','cashReconciliationRequiredDirection_',
      'cashReconciliationRowById_','cashReconciliationEvaluate_',
      'cashReconciliationSortKey_','cashReconciliationBuildRows_',
      'cashReconciliationLinkedUsage_','cashReconciliationFindBuiltRow_',
      'cashReconciliationPhaseMeta_','getCashReconciliationCandidates'
    ]
  },{
    getAllRows_:group=> {
      if(group==='CASH_SESSIONS')return sessions;
      if(group==='CASH_BOOK')return entries;
      throw new Error('Unexpected source table: '+group);
    },
    requirePermission_:(token,module,action)=>{
      assert.equal(token,'synthetic-token');
      assert.equal(module,'cashReconciliation');
      assert.equal(action,'view');
    },
    ok_:data=>({success:true,data}),
    fail_:error=>({success:false,error}),
    logError_:()=>{},
    Session:{getScriptTimeZone:()=>timeZone},
    Utilities:{formatDate:(value,zone,pattern)=>{
      assert.equal(pattern,'yyyy-MM-dd');
      const parts=new Intl.DateTimeFormat('en-GB',{
        timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'
      }).formatToParts(value);
      const get=type=>parts.find(p=>p.type===type).value;
      return [get('year'),get('month'),get('day')].join('-');
    }}
  });
  return plain(source.getCashReconciliationCandidates('synthetic-token',sessionId,phase,query));
}

function parity(sessions,entries,opts={}) {
  const expected=sourceResult(sessions,entries,opts);
  const args={sessionId:'target',phase:'closing',query:'',timeZone,...opts};
  if(!expected.success) {
    assert.throws(()=>projectCashReconciliationCandidates(sessions,entries,args),{
      message:expected.error
    });
    return expected;
  }
  const actual=projectCashReconciliationCandidates(sessions,entries,args);
  assert.deepEqual(actual,expected.data);
  return actual;
}

test('cash-in candidates exclude debit, zero, synthetic and soft-deleted records',()=>{
  const sessions=[session('target')];
  const entries=[
    cash('cash-in',30,'',{_rowIndex:8}),
    cash('debit','',30,{_rowIndex:9}),
    cash('zero',0,0),
    cash('deleted',30,'',{'Is Deleted':'TRUE'}),
    cash('boolean-deleted',30,'',{'Is Deleted':true}),
    cash('session-adjust',30,'',{Type:'Session Open'}),
    cash('day-adjust',30,'',{Type:'Day Close Adjustment'})
  ];
  const result=parity(sessions,entries);
  assert.equal(result.requiredDirection,'Cash In');
  assert.equal(result.requiredAmount,30);
  assert.deepEqual(result.candidates.map(row=>row.entryId),['cash-in']);
  assert.equal(result.candidates[0].direction,'Cash In');
  assert.equal(result.candidates[0].amount,30);
});

test('retains same-phase stored selections while detecting links reused by another session',()=>{
  const sessions=[
    session('prior','Closed','2026-11-14T09:00:00+06:00',{
      'Closing Explanation Entry IDs':['already-used']
    }),
    session('target','Closed','2026-11-16T09:00:00+06:00',{
      'Closing Explanation Entry IDs':'["current","already-used","missing","current"]'
    })
  ];
  const entries=[cash('current',10),cash('already-used',20),cash('fresh',20)];
  const result=parity(sessions,entries);
  assert.deepEqual(result.selectedEntryIds,['current']);
  assert.deepEqual(result.staleEntryIds,['already-used','missing']);
  assert.deepEqual(result.candidates.map(row=>row.entryId),['current','fresh']);
  assert.deepEqual(result.candidates.map(row=>row.selected),[true,false]);
});

test('link reuse within another phase of the same session is not selectable',()=>{
  const sessions=[
    session('baseline','Closed','2026-11-14T09:00:00+06:00',{
      'Expected Cash':100,'Counted Cash':100
    }),
    session('target','Closed','2026-11-16T09:00:00+06:00',{
      'Opening Cash':110,'Opening Explanation Entry IDs':'shared',
      'Closing Explanation Entry IDs':'shared'
    })
  ];
  const result=parity(sessions,[cash('shared',10),cash('new',20)],{phase:'opening'});
  assert.deepEqual(result.selectedEntryIds,[]);
  assert.deepEqual(result.staleEntryIds,['shared']);
  assert.deepEqual(result.candidates.map(row=>row.entryId),['new']);
  assert.equal(result.difference,10);
});

test('cash-out candidates require negative signed movement and preserve query behavior',()=>{
  const sessions=[session('target','Closed',undefined,{
    'Expected Cash':100,'Counted Cash':60,'Closing Explanation Entry IDs':'exp-old'
  })];
  const entries=[
    cash('exp-old','',20,{Type:'Expense',Reference:'BILL-1',Description:'Fuel supplier'}),
    cash('exp-new','',20,{Type:'Expense',Reference:'BILL-2',Description:'Fuel delivery'}),
    cash('incoming',30,'',{Type:'Sale',Description:'Fuel customer receipt'}),
    cash('other','',20,{Type:'Expense',Description:'office costs'})
  ];
  const result=parity(sessions,entries,{phase:'CLOSING',query:'fuel'});
  assert.deepEqual(result.selectedEntryIds,['exp-old']);
  assert.deepEqual(result.candidates.map(row=>row.entryId),['exp-old','exp-new']);
  assert.equal(result.candidates[0].selected,true);
  assert.equal(result.requiredDirection,'Cash Out');
  assert.equal(result.difference,-40);
  const byRef=parity(sessions,entries,{query:' bill-2 '});
  assert.deepEqual(byRef.candidates.map(row=>row.entryId),['exp-new']);
  assert.deepEqual(byRef.selectedEntryIds,['exp-old']);
});

test('newest Date then source row index descending; cap at 250, normalize Bangladesh date',()=>{
  const sessions=[session('target')];
  const entries=Array.from({length:255},(_,i)=>cash('tx-'+i,1,'',{
    Date:'2026-11-16T22:30:00Z',_rowIndex:i+2
  }));
  entries.push(cash('older',1,'',{Date:'2026-11-15T00:00:00Z',_rowIndex:1000}));
  const result=parity(sessions,entries);
  assert.equal(result.candidates.length,250);
  assert.equal(result.candidates[0].entryId,'tx-254');
  assert.equal(result.candidates[0].date,'2026-11-17');
  assert.equal(result.candidates.at(-1).entryId,'tx-5');
});

test('no discrepancy, baseline, nonexistent session and invalid phase match source errors',()=>{
  const normal=[session('target')];
  parity(normal,[cash('a',30)],{phase:'not-a-phase'});
  parity(normal,[],{sessionId:'missing'});
  parity([session('target','Closed',undefined,{
    'Expected Cash':100,'Counted Cash':100
  })],[],{});
  parity([session('target','Closing',undefined,{
    'Expected Cash':'','Counted Cash':''
  })],[],{});
  parity([session('target','Open',undefined,{
    'Opening Cash':100
  })],[],{phase:'opening'});
});

test('stale selected links detect missing, deleted, synthetic, zero and wrong direction',()=>{
  const ids='["missing","deleted","synthetic","zero","reverse","valid","valid"]';
  const sessions=[session('target','Closed',undefined,{
    'Closing Explanation Entry IDs':ids
  })];
  const entries=[
    cash('deleted',30,'',{'Is Deleted':'TRUE'}),
    cash('synthetic',30,'',{Type:'Day Close Adjustment'}),
    cash('zero',0,0),cash('reverse','',30),cash('valid',30)
  ];
  const result=parity(sessions,entries);
  assert.deepEqual(result.selectedEntryIds,['valid']);
  assert.deepEqual(result.staleEntryIds,['missing','deleted','synthetic','zero','reverse']);
  assert.deepEqual(result.candidates.map(c=>c.entryId),['valid']);
});

test('frozen inputs remain unchanged and unloaded/ambiguous data fails closed',()=>{
  const sessions=Object.freeze([Object.freeze(session('target'))]);
  const entries=Object.freeze([Object.freeze(cash('valid',30))]);
  assert.equal(parity(sessions,entries).candidates[0].entryId,'valid');
  assert.throws(()=>projectCashReconciliationCandidates(Promise.resolve(sessions),entries,{
    sessionId:'target',phase:'closing',timeZone
  }),TypeError);
  assert.throws(()=>projectCashReconciliationCandidates(sessions,Promise.resolve(entries),{
    sessionId:'target',phase:'closing',timeZone
  }),TypeError);
  assert.throws(()=>projectCashReconciliationCandidates([null],entries,{
    sessionId:'target',phase:'closing',timeZone
  }),TypeError);
  assert.throws(()=>projectCashReconciliationCandidates(sessions,[null],{
    sessionId:'target',phase:'closing',timeZone
  }),TypeError);
  assert.throws(()=>projectCashReconciliationCandidates(sessions,entries,{
    sessionId:'target',phase:'closing'
  }),TypeError);
  assert.throws(()=>projectCashReconciliationCandidates([session('target'),session('target')],entries,{
    sessionId:'target',phase:'closing',timeZone
  }),/Duplicate Cash Session ID/);
  assert.throws(()=>projectCashReconciliationCandidates(sessions,[cash('dupe',10),cash('dupe',20)],{
    sessionId:'target',phase:'closing',timeZone
  }),/Duplicate Cash Book Entry ID/);
});

test('prototype-shaped transaction IDs have no inherited-object map collisions',()=>{
  const result=projectCashReconciliationCandidates([
    session('target','Closed',undefined,{
      'Closing Explanation Entry IDs':'constructor'
    })
  ],[cash('constructor',30)],{
    sessionId:'target',phase:'closing',timeZone
  });
  assert.deepEqual(result.selectedEntryIds,['constructor']);
  assert.deepEqual(result.staleEntryIds,[]);
  assert.equal(result.candidates[0].entryId,'constructor');
  assert.equal(result.candidates[0].selected,true);
});
