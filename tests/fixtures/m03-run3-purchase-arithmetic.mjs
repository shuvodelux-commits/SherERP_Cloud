/**
 * M03 source-precision slice, deliberately not an accounting implementation.
 * Run the exact arithmetic statements extracted by AST from frozen GAS source
 * with synthetic inputs to capture policy decisions needed before D1 SQL.
 * No operational data, migrations, Worker handlers or financial mutations.
 */
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {parse} from 'acorn';

const allowed=Object.freeze({
  'Purchase.gs':'createPurchase',
  'PurchaseReturn.gs':'completePurchaseReturn'
});

function fromPinnedFunction(filename,first,last,includeNext=false){
  const expected=allowed[filename];
  if(!expected)throw new Error('Unreviewed source file');
  const source=readFileSync(new URL('../../legacy/source/'+filename,import.meta.url),'utf8');
  const declarations=parse(source,{ecmaVersion:'latest',sourceType:'script'}).body
    .filter(node=>node.type==='FunctionDeclaration'&&node.id?.name===expected);
  if(declarations.length!==1)throw new Error('Missing unique pinned function');
  let matches=[];
  const declaration=(stmt,name)=>stmt?.type==='VariableDeclaration'&&
    stmt.declarations?.some(d=>d.id?.type==='Identifier'&&d.id.name===name);
  function visit(node){
    if(!node||typeof node!=='object')return;
    if(node.type==='BlockStatement'){
      const statements=node.body;
      const from=statements.findIndex(s=>declaration(s,first));
      const to=statements.findIndex(s=>declaration(s,last));
      if(from>=0&&to>=from){
        let end=to;
        if(includeNext){
          const next=statements[to+1];
          if(next?.type!=='ExpressionStatement'||
            next.expression?.type!=='AssignmentExpression'||
            next.expression.left?.name!=='totalReturnAmount')
            throw new Error('Pinned return rounding source sequence changed');
          end++;
        }
        matches.push(source.slice(statements[from].start,statements[end].end));
      }
    }
    for(const val of Object.values(node)){
      if(Array.isArray(val)){
        for(const item of val)if(item?.type)visit(item);
      }else if(val?.type){
        visit(val);
      }
    }
  }
  visit(declarations[0].body);
  if(matches.length!==1)throw new Error('Pinned source arithmetic sequence changed');
  return matches[0];
}

// Exact original helper functions, including the original order of floating
// point operations and the source's non-finite/zero handling.
function fromPinnedUtils(name){
  if(!['isValidNonNegativeNumber_','roundMoney_',
    'effectiveTransactionUnitPrice_'].includes(name))
    throw new Error('Unreviewed source utility');
  const source=readFileSync(new URL('../../legacy/source/Utils.gs',import.meta.url),'utf8');
  const matches=parse(source,{ecmaVersion:'latest',sourceType:'script'}).body
    .filter(node=>node.type==='FunctionDeclaration'&&node.id?.name===name);
  if(matches.length!==1)throw new Error('Pinned source utility changed');
  return source.slice(matches[0].start,matches[0].end);
}
const sourceHelpers=['isValidNonNegativeNumber_','roundMoney_',
  'effectiveTransactionUnitPrice_'].map(fromPinnedUtils).join('\n');
const purchaseStatements=fromPinnedFunction('Purchase.gs','discount','paymentMethod');
const returnStatements=fromPinnedFunction('PurchaseReturn.gs','grossUnitPrice','storedUnitPrice',true);
const plain=result=>JSON.parse(JSON.stringify(result));

export function sourcePurchaseAmounts({subtotal,discount,paidAmount,paymentMethod}){
  if(typeof subtotal!=='number'||!Number.isFinite(subtotal)||subtotal<0)
    throw new Error('Invalid synthetic subtotal');
  const payload={discount,paidAmount,paymentMethod};
  const result=runInNewContext(
    '(()=>{'+sourceHelpers+'\n'+purchaseStatements+
    '\nreturn {discount,grandTotal,paidAmount,dueAmount,paymentStatus,paymentMethod};})()',
    {payload,subtotal},
    {timeout:1000,contextCodeGeneration:{strings:false,wasm:false}}
  );
  return plain(result);
}

export function sourceSupplierReturnAmounts({
  qty,boughtQty,grossValue,purchaseSubtotal,purchaseGrandTotal
}){
  const inputs=[qty,boughtQty,grossValue,purchaseSubtotal,purchaseGrandTotal];
  if(inputs.some(v=>typeof v!=='number'||!Number.isFinite(v)||v<0)||
    boughtQty===0||qty===0||qty>boughtQty||purchaseSubtotal===0)
    throw new Error('Invalid synthetic return quantity/amounts');
  const bought={boughtQty,grossValue};
  const result=runInNewContext(
    '(()=>{'+sourceHelpers+'\nlet totalReturnAmount=0;'+returnStatements+
    '\nreturn {lineTotal,storedUnitPrice,totalReturnAmount};})()',
    {qty,bought,purchaseSubtotal,purchaseGrandTotal},
    {timeout:1000,contextCodeGeneration:{strings:false,wasm:false}}
  );
  return plain(result);
}
