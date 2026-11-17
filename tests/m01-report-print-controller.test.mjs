import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {runInNewContext} from 'node:vm';

const source=await readFile(new URL('../src/ui/m01-report-print-controller.js',import.meta.url),'utf8');

function fixture(){
  const nodes=new Map();
  const node=id=>{
    const handlers=new Map();
    const x={
      id, hidden:false, value:'', textContent:'', title:'', disabled:false,
      addEventListener(kind,fn){
        const row=handlers.get(kind)||[];
        row.push(fn);handlers.set(kind,row);
      },
      emit(kind){
        const event={prevented:false,stopped:false,
          preventDefault(){this.prevented=true;},
          stopImmediatePropagation(){this.stopped=true;}
        };
        for(const fn of handlers.get(kind)||[])fn(event);
        return event;
      }
    };
    nodes.set(id,x);return x;
  };
  const print=node('rptPrintBtn');
  const from=node('rptFrom');from.value='2026-11-01';
  const to=node('rptTo');to.value='2026-11-17';
  const login=node('loginOverlay');login.hidden=true;
  const shop=node('shopNameLabel');shop.textContent='Synthetic Shop';
  for(const id of ['rptRunBtn','rptTodayBtn','rptMonthBtn'])node(id);
  const tabs=['rptSales','rptPurchase','rptStock','rptCashBank','rptProfit','rptBalanceSheet']
    .map((id)=>node('tab:'+id));
  const document={getElementById:id=>nodes.get(id)||null,
    querySelectorAll:()=>tabs,addEventListener(){}};
  const window={addEventListener(){}};
  const ctx={window,document,
    authToken:'synthetic-token-A',
    currentUser:{id:'synthetic-user',tenantId:'synthetic-tenant'},
    rptState:{activeTab:'rptSales',loaded:{}}
  };
  runInNewContext(source,ctx);
  const guard=window.__m01ReportPrintState;
  assert.ok(guard,'compiled controller installed');
  return {ctx,guard,print,from,to,nodes};
}
function finish(f,tab){
  const ticket=f.guard.start(tab);
  const accepted=f.guard.complete(ticket);
  f.ctx.rptState.loaded[tab]=accepted;
  f.guard.refresh();
  return accepted;
}

test('original Reports Print is blocked before a completed load and after a failed attempt',()=>{
  const f=fixture();
  assert.equal(f.print.disabled,true);
  assert.equal(f.print.emit('click').prevented,true);
  const ticket=f.guard.start('rptSales');
  assert.equal(f.print.disabled,true);
  f.guard.fail(ticket);
  assert.equal(f.guard.isCurrent('rptSales'),false);
  assert.equal(f.print.disabled,true);
});

test('successful matching Sales report prints, then date edits and invalid dates fail closed',()=>{
  const f=fixture();
  assert.equal(finish(f,'rptSales'),true);
  assert.equal(f.print.disabled,false);
  assert.equal(f.print.emit('click').prevented,false);
  f.to.value='2026-11-16';
  f.to.emit('input');
  assert.equal(f.print.disabled,true);
  assert.equal(f.ctx.rptState.loaded.rptSales,false);
  assert.equal(finish(f,'rptSales'),true);
  assert.equal(f.print.disabled,false);
  f.from.value='2026-11-31';
  f.from.emit('change');
  const ticket=f.guard.start('rptSales');
  assert.equal(f.guard.complete(ticket),false);
  assert.equal(f.print.disabled,true);
});

test('stale pending load cannot print even after later same-tab success and old DOM paint',()=>{
  const f=fixture();
  const old=f.guard.start('rptSales');
  const latest=f.guard.start('rptSales');
  assert.equal(f.guard.complete(latest),true);
  f.ctx.rptState.loaded.rptSales=true;f.guard.refresh();
  assert.equal(f.print.disabled,false);
  assert.equal(f.guard.complete(old),false,'late older report must contaminate current readiness');
  f.guard.refresh();
  assert.equal(f.print.disabled,true);
  assert.equal(f.ctx.rptState.loaded.rptSales,false);
  const invalid=f.guard.start('rptSales');
  f.to.value='2026-11-15';f.to.emit('change');
  assert.equal(f.guard.complete(invalid),false);
  assert.equal(f.guard.isCurrent('rptSales'),false);
});

test('same actor tenant/session turnover and signed-out state revoke report Print',()=>{
  const f=fixture();
  assert.equal(finish(f,'rptSales'),true);
  f.ctx.authToken='synthetic-token-B';
  assert.equal(f.guard.refresh(),false,'same actor with new token must reload');
  assert.equal(f.print.disabled,true);
  const b=f.guard.start('rptSales');
  assert.equal(f.guard.complete(b),true);f.ctx.rptState.loaded.rptSales=true;
  assert.equal(f.guard.refresh(),true);
  f.ctx.currentUser={id:'synthetic-user',tenantId:'OTHER-TENANT'};
  assert.equal(f.guard.refresh(),false);
  f.ctx.currentUser=null;
  assert.equal(f.guard.refresh(),false);
});

test('Stock and Balance Sheet snapshots remain printable after unrelated period input changes',()=>{
  const f=fixture();
  f.ctx.rptState.activeTab='rptStock';
  assert.equal(finish(f,'rptStock'),true);
  f.to.value='2026-11-16';f.to.emit('input');
  assert.equal(f.guard.refresh(),true);
  f.ctx.rptState.activeTab='rptBalanceSheet';
  assert.equal(finish(f,'rptBalanceSheet'),true);
  assert.equal(f.print.disabled,false);
  f.nodes.get('rptRunBtn').emit('click');
  assert.equal(f.print.disabled,true,'explicit Run clears cached snapshot as original source does');
});

test('unrecognized report tab and hidden login overlay fail closed',()=>{
  const f=fixture();
  f.ctx.rptState.activeTab='rptUnknown';
  assert.equal(f.guard.refresh(),false);
  f.ctx.rptState.activeTab='rptSales';
  f.nodes.get('loginOverlay').hidden=false;
  const ticket=f.guard.start('rptSales');
  assert.equal(f.guard.complete(ticket),false);
  assert.equal(f.print.disabled,true);
});
