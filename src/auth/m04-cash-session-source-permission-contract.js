/**
 * M04 OFFLINE SOURCE CONTRACT ONLY.
 *
 * Parses pinned legacy/source/CashSession.gs using Acorn to prevent an
 * accidental permission/action change from being presented as approved
 * M03/M04 integration. This is NOT authentication, a grant, a policy
 * evaluator, SQL, a cash writer, or a deployable RPC dependency.
 * Actual M04 sessions/role grants must be checked inside M03's atomic SQL.
 */
import {parse} from 'acorn';

const REQUIRED=Object.freeze({
  startCashSession:Object.freeze({module:'pos',action:'add'}),
  closeCashSession:Object.freeze({module:'pos',action:'add'}),
  getCashSessionSummary:Object.freeze({module:'pos',action:'view'}),
});
const PRIVATE=Object.freeze([
  'getActiveCashSession_',
  'requireActiveCashSession_',
]);
const ERROR='Cash Session source contract mismatch';

function requireMatch(value){
  if(!value)throw new Error(ERROR);
}

function visit(node,fn){
  if(!node || typeof node!=='object')return;
  if(Array.isArray(node)){
    for(const item of node)visit(item,fn);
    return;
  }
  if(typeof node.type!=='string')return;
  fn(node);
  for(const [key,value] of Object.entries(node)){
    if(key!=='type' && key!=='start' && key!=='end')visit(value,fn);
  }
}

function exactFunction(program,name){
  const matches=program.body.filter(node=>
    node.type==='FunctionDeclaration' && node.id?.name===name);
  requireMatch(matches.length===1);
  requireMatch(matches[0].body?.type==='BlockStatement');
  return matches[0];
}

function namedCall(node,name){
  return node?.type==='CallExpression' &&
    node.callee?.type==='Identifier' && node.callee.name===name;
}

function literal(node,value){
  return node?.type==='Literal' && node.value===value;
}

function exactPermission(fn,expected){
  // The source acquires a GAS lock before entering try, then checks
  // permission as the first statement of the protected body.
  const guarded=fn.body.body.filter(node=>node.type==='TryStatement');
  requireMatch(guarded.length===1);
  const first=guarded[0].block?.body?.[0];
  const call=first?.type==='ExpressionStatement' ? first.expression : null;
  requireMatch(namedCall(call,'requirePermission_'));
  requireMatch(call.arguments.length===3);
  requireMatch(call.arguments[0]?.type==='Identifier' &&
    call.arguments[0].name==='token');
  requireMatch(literal(call.arguments[1],expected.module) &&
    literal(call.arguments[2],expected.action));

  // Comments, forged literal text and an extra permission check do not
  // satisfy the one-checked-entry-point source contract.
  let count=0;
  visit(fn.body,node=>{
    if(namedCall(node,'requirePermission_'))count++;
  });
  requireMatch(count===1);
}

function statusRead(node){
  return node?.type==='MemberExpression' && node.computed===true &&
    literal(node.property,'Status');
}

function exactlyOpenGuard(fn){
  let strict=0,helperCalls=0;
  visit(fn.body,node=>{
    if(namedCall(node,'getActiveCashSession_'))helperCalls++;
    if(node.type!=='IfStatement')return;
    const check=node.test;
    if(check?.type!=='BinaryExpression' || check.operator!=='!=='
      || !statusRead(check.left) || !literal(check.right,'Open'))return;
    const body=node.consequent;
    if(body?.type!=='BlockStatement')return;
    if(!body.body.some(child=>child.type==='ThrowStatement'))return;
    const value=check.left.object;
    if(value?.type!=='MemberExpression' || value.computed ||
      value.object?.type!=='Identifier' || value.object.name!=='result' ||
      value.property?.type!=='Identifier' || value.property.name!=='data')return;
    strict++;
  });
  requireMatch(fn.params.length===0 && helperCalls===1 && strict===1);
}

function originalDiscoverability(fn){
  // The legacy "Closing" state is discoverable to retry Close Day.
  // This must not be confused with permission to POST while Closing.
  let matches=0;
  visit(fn.body,node=>{
    if(node.type!=='LogicalExpression' || node.operator!=='||')return;
    const [left,right]=[node.left,node.right];
    const match=(x,v)=>x?.type==='BinaryExpression' &&
      x.operator==='===' && statusRead(x.left) && literal(x.right,v);
    if(match(left,'Open') && match(right,'Closing'))matches++;
  });
  requireMatch(matches===1);
}

function sourceProgram(source){
  requireMatch(typeof source==='string' && source.length>0 &&
    source.length<=100000 && !source.includes('\0'));
  try{
    return parse(source,{ecmaVersion:'latest',sourceType:'script'});
  }catch{
    throw new Error(ERROR);
  }
}

/**
 * Test-only, fail-closed frozen source inspection. The result intentionally
 * contains no "authorized:true" field and cannot authorize any transaction.
 */
export function inspectFrozenCashSessionSourceContract(source){
  const program=sourceProgram(source);
  for(const [name,permission] of Object.entries(REQUIRED)){
    exactPermission(exactFunction(program,name),permission);
  }
  for(const name of PRIVATE)exactFunction(program,name);
  // Browser-callable global aliases would bypass the source's private
  // trailing-underscore separation, so refuse them explicitly.
  for(const name of ['getActiveCashSession','requireActiveCashSession']){
    requireMatch(!program.body.some(node=>
      node.type==='FunctionDeclaration' && node.id?.name===name));
  }
  exactlyOpenGuard(exactFunction(program,'requireActiveCashSession_'));
  originalDiscoverability(exactFunction(program,'getActiveCashSession_'));

  return {
    sourceContractVerified:true,
    operations:{
      startCashSession:{module:'pos',action:'add'},
      closeCashSession:{module:'pos',action:'add'},
      getCashSessionSummary:{module:'pos',action:'view'},
    },
    privateOnly:[...PRIVATE],
    postingStatus:'Open',
    operationalAuthorization:false,
    productionPostingAllowed:false,
  };
}
