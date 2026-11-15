/**
 * Test-only loader for selected original GAS functions.
 * Execute exact pinned source in a Node VM with explicit synthetic stubs.
 * This is neither a Worker implementation nor a security boundary for
 * untrusted code; it must never accept user input or run live data.
 */
import {readFileSync} from 'node:fs';
import {parse} from 'acorn';
import {runInNewContext} from 'node:vm';

const ALLOWED = new Set(['Utils.gs','CashBook.gs','CashSession.gs','BankBook.gs','BankLedger.gs','PartyLedger.gs','DeleteEngine.gs']);
const VALID_NAME = /^[A-Za-z_$][\w$]*$/;

/**
 * @param {Record<string,string[]>} selections: reviewed source files and function names
 * @param {Record<string,unknown>} stubs: synthetic, explicitly supplied test dependencies
 */
export function loadPinnedGASFunctions(selections,stubs={}) {
  if(!selections || typeof selections!=='object' || Array.isArray(selections) ||
     !stubs || typeof stubs!=='object' || Array.isArray(stubs))
    throw new Error('Invalid M08 source test selections or stubs');
  const code=[],exposed=[],seen=new Set();
  for(const [filename,names] of Object.entries(selections)) {
    if(!ALLOWED.has(filename) || !Array.isArray(names) || names.length===0)
      throw new Error('Invalid M08 source test module');
    const content=readFileSync(new URL('../../legacy/source/'+filename,import.meta.url),'utf8');
    const parsed=parse(content,{ecmaVersion:'latest',sourceType:'script'});
    const definitions=new Map();
    for(const node of parsed.body) {
      if(node.type!=='FunctionDeclaration')continue;
      const name=node.id?.name;
      if(!name || definitions.has(name))
        throw new Error('M08 source function missing name or duplicate');
      definitions.set(name,content.slice(node.start,node.end));
    }
    for(const name of names) {
      if(typeof name!=='string' || !VALID_NAME.test(name) ||
         !definitions.has(name) || seen.has(name))
        throw new Error('Unknown or duplicate M08 selected GAS function: '+name);
      seen.add(name);
      code.push(definitions.get(name));
      exposed.push(name);
    }
  }
  if(!exposed.length)throw new Error('M08 source test selection must not be empty');
  // The VM is an isolation aid for pinned test code only, NOT a general sandbox.
  // No GAS services, filesystem, network or application handles are supplied.
  const context=Object.assign(Object.create(null),stubs);
  return runInNewContext(code.join('\n')+'\n({'+exposed.join(',')+'})',
    context,{timeout:1000,contextCodeGeneration:{strings:false,wasm:false}});
}
