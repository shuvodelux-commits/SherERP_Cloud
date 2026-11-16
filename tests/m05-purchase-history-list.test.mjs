import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import vm from 'node:vm';
import {projectPurchaseManagementList} from '../src/modules/m05-purchase-history-list.js';

const frozen=readFileSync(new URL('../legacy/source/PurchaseManagement.gs',import.meta.url),'utf8');
const sourceAst=parse(frozen,{ecmaVersion:'latest',sourceType:'script'});
const sourceDeclaration=sourceAst.body.find(node=>
  node.type==='FunctionDeclaration'&&node.id.name==='getPurchaseManagementList');
assert.ok(sourceDeclaration,'Frozen purchase history function must be present');
const original=frozen.slice(sourceDeclaration.start,sourceDeclaration.end);
const clean=value=>JSON.parse(JSON.stringify(value));

const purchase=(id,date,other={})=>({
  'Purchase ID':id,'Date':date,'Supplier ID':'SUP-A',
  'Supplier Name':'First supplier','Grand Total':'100',
  'Paid Amount':'40','Due Amount':'60','Payment Status':'Partial',
  'Payment Method':'Bank','Notes':'Original purchase','Is Deleted':'FALSE',
  ...other
});
const returned=(id,purchaseId,total,other={})=>({
  'Return ID':id,'Purchase ID':purchaseId,'Total Return Amount':total,
  'Is Deleted':'FALSE',...other
});
const settlement=(purchaseId,supplierId,paidAmount,dueAmount,paymentStatus)=>({
  purchaseId,supplierId,paidAmount,dueAmount,paymentStatus
});
const fixture=()=>({
  purchases:[
    purchase('PUR-OLD','2026-11-14'),
    purchase('PUR-SAME','2026-11-14',{
      'Grand Total':'30','Paid Amount':0,'Due Amount':30,'Payment Status':'Due',
      'Payment Method':'','Notes':''
    }),
    purchase('PUR-NEW','2026-11-15',{
      'Supplier ID':'SUP-B','Supplier Name':'Second supplier',
      'Grand Total':'10','Paid Amount':'10','Due Amount':0,'Payment Status':'Paid',
      'Payment Method':'','Notes':''
    }),
    purchase('PUR-UNLINKED','2026-11-16',{
      'Supplier ID':'','Supplier Name':'','Grand Total':25,'Paid Amount':0,
      'Due Amount':25,'Payment Status':'Due','Payment Method':'','Notes':''
    }),
    purchase('PUR-DELETED','2026-11-17',{'Is Deleted':'TRUE'})
  ],
  returns:[
    returned('RET-1','PUR-OLD',15),
    returned('RET-2','PUR-OLD',80,{'Is Deleted':'TRUE'}),
    returned('RET-3','PUR-SAME',30)
  ],
  settlements:[
    settlement('PUR-OLD','SUP-A',55,45,'Partial'),
    settlement('PUR-SAME','SUP-A',0,0,'Paid')
  ]
});
const project=rows=>projectPurchaseManagementList(rows);

function native(snapshot){
  const reads=[],callCount=new Map();
  const frozenSettlement=new Map(snapshot.settlements.map(s=>[s.purchaseId,s]));
  const rows={PURCHASES:snapshot.purchases,PURCHASE_RETURN:snapshot.returns};
  const ctx=vm.createContext({
    requirePermission_:(token,module,action)=>{
      assert.deepEqual([token,module,action],['test-server-token','purchase','view']);
    },
    activeRows_:group=>{
      reads.push(group);
      return rows[group].filter(row=>String(row['Is Deleted']||'').trim().toUpperCase()!=='TRUE');
    },
    getAllRows_:group=>{
      assert.equal(group,'SUPPLIER_LEDGER');
      reads.push(group);
      return [
        {'Ledger ID':'L-1','Supplier ID':'SUP-A'},
        {'Ledger ID':'L-2','Supplier ID':'SUP-B'}
      ];
    },
    supplierSettlementState_:(supplierId,{ledgerRows,returnRows})=>{
      callCount.set(supplierId,(callCount.get(supplierId)||0)+1);
      assert.ok(ledgerRows.every(row=>row['Supplier ID']===supplierId));
      assert.ok(returnRows.every(row=>row['Is Deleted']!=='TRUE'));
      return {supplierId};
    },
    supplierPurchaseSettlementSnapshotFromState_:(p,state)=>{
      assert.equal(state.supplierId,p['Supplier ID']);
      const snapshotRow=frozenSettlement.get(p['Purchase ID']);
      assert.ok(snapshotRow,'native test oracle missing trusted settlement');
      return snapshotRow;
    },
    safeDateOnly_:date=>date,
    ok_:data=>({success:true,data}),
    fail_:message=>({success:false,message}),
    logError_:()=>{}
  });
  vm.runInContext(original,ctx);
  const result=ctx.getPurchaseManagementList('test-server-token');
  assert.equal(result.success,true,result.message);
  const used=['PURCHASES','PURCHASE_RETURN','SUPPLIER_LEDGER'];
  assert.deepEqual(reads,used.slice(0,reads.length));
  return {list:clean(result.data),calls:Object.fromEntries(callCount)};
}

test('full native GAS history shape, descending date and stable equal-date order',()=>{
  const rows=fixture(),before=structuredClone(rows);
  const actual=project(rows),expected=native(rows);
  assert.deepEqual(actual,expected.list);
  assert.deepEqual(actual.map(x=>x.purchaseId),
    ['PUR-UNLINKED','PUR-NEW','PUR-OLD','PUR-SAME']);
  assert.deepEqual(expected.calls,{'SUP-A':1},'source computes one settlement state per supplier');
  assert.deepEqual(Object.keys(actual[0]),[
    'purchaseId','date','supplierId','supplierName','grandTotal',
    'paidAmount','dueAmount','returnedAmount','netPurchase','paymentStatus',
    'paymentMethod','returnStatus','notes','editable'
  ]);
  assert.deepEqual(rows,before,'history read must not mutate inputs');
});

test('returned and settled purchase keeps historical original ID with current paid and due',()=>{
  const result=project(fixture());
  const old=result.find(x=>x.purchaseId==='PUR-OLD');
  assert.deepEqual(old,{
    purchaseId:'PUR-OLD',date:'2026-11-14',supplierId:'SUP-A',
    supplierName:'First supplier',grandTotal:100,paidAmount:55,dueAmount:45,
    returnedAmount:15,netPurchase:85,paymentStatus:'Partial',
    paymentMethod:'Bank',returnStatus:'Partially Returned',
    notes:'Original purchase',editable:false
  });
  const full=result.find(x=>x.purchaseId==='PUR-SAME');
  assert.equal(full.returnStatus,'Fully Returned');
  assert.equal(full.netPurchase,0);
  assert.equal(full.paymentStatus,'Paid');
  assert.equal(full.editable,false);
  assert.deepEqual(result,native(fixture()).list);
});

test('unpaid historical purchases and no-supplier purchase do not infer settlement or auto-net Party accounts',()=>{
  const rows=fixture();
  const result=project(rows);
  assert.equal(result.find(x=>x.purchaseId==='PUR-NEW').paidAmount,10);
  assert.equal(result.find(x=>x.purchaseId==='PUR-NEW').paymentMethod,'Cash');
  assert.equal(result.find(x=>x.purchaseId==='PUR-UNLINKED').dueAmount,25);
  assert.equal(result.find(x=>x.purchaseId==='PUR-UNLINKED').editable,true);
  assert.deepEqual(result,native(rows).list);
});

test('settlement need uses source strict >0.004 threshold',()=>{
  const rows=fixture();
  rows.purchases=[purchase('P-THRESH','2026-11-16',{
    'Grand Total':1,'Paid Amount':0.996,'Due Amount':0.004,
    'Payment Status':'Partial'
  })];
  rows.returns=[];
  rows.settlements=[];
  assert.deepEqual(project(rows),native(rows).list);
  rows.purchases[0]['Due Amount']=0.005;
  assert.throws(()=>project(rows),/missing.*settlement/i);
  rows.settlements=[settlement('P-THRESH','SUP-A',1,0,'Paid')];
  assert.deepEqual(project(rows),native(rows).list);
});

test('no active purchase requires settlement: empty trusted records accepted',()=>{
  const rows={purchases:[],returns:[],settlements:[]};
  assert.deepEqual(project(rows),[]);
  assert.deepEqual(project(rows),native(rows).list);
});

test('missing or wrong supplier settlement proof is never silently treated as header due',()=>{
  const rows=fixture();
  rows.settlements=[];
  assert.throws(()=>project(rows),/missing.*settlement/i);
  rows.settlements=[settlement('PUR-OLD','SUP-OTHER',55,45,'Partial'),
    settlement('PUR-SAME','SUP-A',0,0,'Paid')];
  assert.throws(()=>project(rows),/supplier.*mismatch/i);
  rows.settlements=[settlement('PUR-OLD','SUP-A',55,45,'Partial'),
    settlement('PUR-OLD','SUP-A',55,45,'Partial'),
    settlement('PUR-SAME','SUP-A',0,0,'Paid')];
  assert.throws(()=>project(rows),/duplicate.*settlement/i);
});

test('duplicate active purchase IDs and orphan active returns are blocked',()=>{
  const rows=fixture();
  rows.purchases.push(purchase('PUR-OLD','2026-11-14'));
  assert.throws(()=>project(rows),/duplicate.*purchase/i);
  rows.purchases.pop();
  rows.returns.push(returned('RET-ORPHAN','PUR-NOT-FOUND',5));
  assert.throws(()=>project(rows),/orphan.*return/i);
});

test('untrusted nonfinite money and invalid dates fail closed before formatting',()=>{
  const rows=fixture();
  rows.purchases[0]['Grand Total']='Infinity';
  assert.throws(()=>project(rows),/invalid.*amount/i);
  rows.purchases[0]['Grand Total']='100';
  rows.purchases[0].Date='2026-11-31';
  assert.throws(()=>project(rows),/invalid.*date/i);
  rows.purchases[0].Date='2026-11-14T00:00:00Z';
  assert.throws(()=>project(rows),/canonical.*date/i);
  rows.purchases[0].Date='2026-11-14';
  rows.returns[0]['Total Return Amount']={value:15};
  assert.throws(()=>project(rows),/invalid.*amount/i);
});

test('trusted record validation rejects accessors, nonplain rows and missing arrays',()=>{
  assert.throws(()=>projectPurchaseManagementList(null),/snapshot/i);
  assert.throws(()=>project({purchases:[],returns:null,settlements:[]}),/snapshot/i);
  assert.throws(()=>project({purchases:[new Date()],returns:[],settlements:[]}),/row/i);
  const accessor=Object.defineProperty({},'Purchase ID',{get(){throw Error('unsafe');}});
  assert.throws(()=>project({purchases:[accessor],returns:[],settlements:[]}),/row|accessor/i);
  assert.throws(()=>project({purchases:[],returns:[],settlements:[[]]}),/row/i);
});

test('pure Purchase History list is not exposed on Worker RPC and cannot query or post',()=>{
  const runtime=readFileSync(new URL('../src/index.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8');
  const code=readFileSync(new URL('../src/modules/m05-purchase-history-list.js',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/projectPurchaseManagementList|m05-purchase-history-list/);
  assert.doesNotMatch(code,/SpreadsheetApp|LockService|\bfetch\s*\(|\.batch\s*\(|\.run\s*\(|\.put\s*\(/);
});
