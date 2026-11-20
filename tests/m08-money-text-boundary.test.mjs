/**
 * M08 Run 6: actual M06 legacy Number-output precision boundary.
 * This verifies a newly proposed fail-closed adapter; it never posts money.
 * Owner numeric scale/tie/maximum remains unsigned.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeSalePayments_,salePaymentPaisa_} from '../src/modules/sale-payments.js';
import {
  minorPaisaToBdtText,bdtTextToMinorPaisa,
  auditM06MoneyNumbers
} from '../src/modules/m08-money-text-boundary.js';

const bankAccounts=Object.freeze([Object.freeze({
  'Bank Account ID':'BANK-A','Account Name':'Test Bank','Account Type':'Bank',
  'Status':'Active','Is Deleted':'FALSE'
})]);
const bank=(paisa,id='BANK-1')=>({
  id,method:'Bank',amount:minorPaisaToBdtText(paisa),accountId:'BANK-A'
});
const cash=(paisa,id='CASH-1')=>({
  id,method:'Cash',amount:minorPaisaToBdtText(paisa)
});
const check=(grandPaisa,payments,accountRows=bankAccounts)=>
  auditM06MoneyNumbers({grandPaisa,payments,accountRows});

test('M08 high-range RED evidence: the unchanged M06 Number return loses a paisa when re-parsed',()=>{
  const original='90071992547409.91';
  const exact=9007199254740991n;
  assert.equal(salePaymentPaisa_(original,'Fixture gross',false),Number(exact));
  const legacy=normalizeSalePayments_(original,[],[]);
  assert.equal(legacy.dueAmount.toString(),'90071992547409.9');
  assert.equal(salePaymentPaisa_(legacy.dueAmount,'Reparsed due',false),Number(exact-1n));
  assert.equal(bdtTextToMinorPaisa(String(legacy.dueAmount)),'9007199254740990');
});

test('lossless canonical paisa→BDT text never calls Number or drops the final paisa',()=>{
  assert.equal(minorPaisaToBdtText('9007199254740991'),'90071992547409.91');
  assert.equal(minorPaisaToBdtText('100'),'1.00');
  assert.equal(minorPaisaToBdtText('101'),'1.01');
  assert.equal(minorPaisaToBdtText('1'),'0.01');
  assert.equal(minorPaisaToBdtText('0'),'0.00');
  assert.equal(bdtTextToMinorPaisa('90071992547409.91'),'9007199254740991');
  assert.equal(bdtTextToMinorPaisa('0.5'),'50');
  assert.equal(bdtTextToMinorPaisa('0'),'0');
  assert.equal(bdtTextToMinorPaisa('1.00'),'100');
});

test('the M08 adapter FAILS CLOSED on the exact high-value M06 due round-trip loss',()=>{
  assert.throws(()=>check('9007199254740991',[]),/lossy|mismatch|precision/i);
});

test('normal two-line M08 header and M06 Bank/Cash split conserve each paisa and change',()=>{
  const r=check('67',[bank('25'),cash('50')]);
  assert.equal(r.grandPaisa,'67');
  assert.equal(r.paidPaisa,'67');
  assert.equal(r.duePaisa,'0');
  assert.equal(r.cashChangePaisa,'8');
  assert.deepEqual(r.legs.map(x=>[
    x.rowId,x.method,x.appliedPaisa,x.tenderedPaisa,x.changePaisa
  ]),[
    ['BANK-1','Bank','25','25','0'],
    ['CASH-1','Cash','42','50','8']
  ]);
  assert.equal(r.safeForM08SyntheticReview,true);
  assert.equal(Object.hasOwn(r,'posted'),false);
});

test('unpaid amount is retained as integer paisa, not converted to a floating ledger due',()=>{
  const r=check('67',[]);
  assert.equal(r.paidPaisa,'0');
  assert.equal(r.duePaisa,'67');
  assert.equal(r.legs.length,0);
  assert.equal(r.cashChangePaisa,'0');
});

test('a Cash payment partly covers an invoice without inventing Bank/Cash book movements',()=>{
  const r=check('500',[cash('325')]);
  assert.deepEqual([r.paidPaisa,r.duePaisa,r.cashChangePaisa],['325','175','0']);
  assert.equal(r.legs[0].appliedPaisa,'325');
});

test('existing M06 rules reject Bank overpayment and duplicate payment row IDs',()=>{
  assert.throws(()=>check('67',[bank('68')]),/exceed/i);
  assert.throws(()=>check('67',[cash('30'),cash('30')]),/one Cash|duplicate/i);
  assert.throws(()=>check('67',[bank('20'),bank('20')]),/duplicate/i);
});

test('M06 rejects invalid Bank identity while M08 rejects sub-paisa and exponent tender input',()=>{
  assert.throws(()=>check('67',[{id:'BANK',method:'Bank',amount:'0.25',accountId:'FOREIGN'}]),/active payment account/i);
  assert.throws(()=>check('67',[{id:'CASH',method:'Cash',amount:'0.001'}]),TypeError);
  assert.throws(()=>check('67',[{id:'CASH',method:'Cash',amount:'1e3'}]),TypeError);
});

test('invalid canonical input values or unsafe JS numeric input are rejected before M06',()=>{
  for(const value of [null,undefined,{},[],1,0.1,NaN,Infinity,'',' ','-0','01',
    '1.0','1e3','-1','+1','9007199254740992','000001','1.00']){
    assert.throws(()=>minorPaisaToBdtText(value),TypeError);
  }
  assert.throws(()=>check('0.50',[]),TypeError);
  assert.throws(()=>check('1',[{id:'CASH-1',method:'Cash',amount:0.01}]),TypeError);
  assert.throws(()=>bdtTextToMinorPaisa('0.001'),TypeError);
  assert.throws(()=>bdtTextToMinorPaisa('1e3'),TypeError);
  assert.throws(()=>bdtTextToMinorPaisa('90071992547409.92'),RangeError);
});

test('signed correction probes are opt-in, preserve -1 paisa and reject negative zero',()=>{
  assert.equal(minorPaisaToBdtText('-1',{signed:true}),'-0.01');
  assert.equal(bdtTextToMinorPaisa('-0.01',{signed:true}),'-1');
  assert.equal(minorPaisaToBdtText('-9007199254740991',{signed:true}),'-90071992547409.91');
  assert.throws(()=>minorPaisaToBdtText('-1'),TypeError);
  assert.throws(()=>bdtTextToMinorPaisa('-1.00'),TypeError);
  assert.throws(()=>bdtTextToMinorPaisa('-0.00',{signed:true}),TypeError);
  assert.throws(()=>minorPaisaToBdtText('-0',{signed:true}),TypeError);
});

test('opaque non-data records and accessors cannot influence money or payment intent',()=>{
  const row={id:'BANK-1',method:'Bank',accountId:'BANK-A'};
  Object.defineProperty(row,'amount',{get(){throw Error('user-supplied code');},enumerable:true});
  assert.throws(()=>check('67',[row]),/plain|data|accessor|record/i);
  assert.throws(()=>check('67',new Proxy([],{getPrototypeOf:()=>null})),TypeError);
  assert.throws(()=>check('67',[bank('25')],new Date()),TypeError);
});

test('adapter never mutates frozen M06 payment instructions or bank account snapshots',()=>{
  const instructions=Object.freeze([
    Object.freeze({id:'BANK-1',method:'Bank',amount:'0.25',accountId:'BANK-A'}),
    Object.freeze({id:'CASH-1',method:'Cash',amount:'0.50'})
  ]);
  const r=check('67',instructions);
  assert.equal(r.paidPaisa,'67');
  assert.equal(instructions[0].amount,'0.25');
  assert.equal(bankAccounts[0]['Bank Account ID'],'BANK-A');
});

test('zero-amount invoice blocks nonzero cash tender using original source rule',()=>{
  assert.throws(()=>check('0',[cash('1')]),/zero-value/i);
  const r=check('0',[]);
  assert.equal(r.duePaisa,'0');
  assert.equal(r.paidPaisa,'0');
});

test('300 deterministic split-payment cases conserve exact integer paisa and remain unchanged',()=>{
  let seed=93176661;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let i=0;i<300;i++){
    const grand=1n+BigInt(random()%100000000);
    const bankPaid=BigInt(random()%Number(grand+1n));
    const cashApplied=BigInt(random()%Number(grand-bankPaid+1n));
    const cashChange=BigInt(random()%200);
    const amount=cashApplied+cashChange;
    const sourceCashApplied=amount<grand-bankPaid?amount:grand-bankPaid;
    const expectedChange=amount-sourceCashApplied;
    const instructions=[
      ...(bankPaid>0n?[bank(String(bankPaid))]:[]),
      ...(amount>0n?[cash(String(amount))]:[])
    ];
    const r=check(String(grand),instructions);
    assert.equal(BigInt(r.paidPaisa)+BigInt(r.duePaisa),grand);
    assert.equal(BigInt(r.cashChangePaisa),expectedChange);
    assert.equal(r.legs.reduce((s,p)=>s+BigInt(p.appliedPaisa),0n),BigInt(r.paidPaisa));
    assert.equal(r.legs.filter(p=>p.method==='Cash').reduce((s,p)=>
      s+BigInt(p.tenderedPaisa)-BigInt(p.appliedPaisa),0n),expectedChange);
  }
});

test('every accepted tender leg retains its exact original instruction after source normalization',()=>{
  const intents=Object.freeze([
    Object.freeze({id:'BANK-1',method:'Bank',amount:'0.25',accountId:'BANK-A'}),
    Object.freeze({id:'CASH-1',method:'Cash',amount:'0.50'})
  ]);
  const result=check('67',intents);
  const sourceById=new Map(intents.map(row=>[row.id,bdtTextToMinorPaisa(row.amount)]));
  for(const leg of result.legs){
    assert.equal(leg.tenderedPaisa,sourceById.get(leg.rowId));
  }
  assert.equal(result.cashChangePaisa,'8');
});
