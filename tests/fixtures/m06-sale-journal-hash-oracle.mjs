/** Test-only GAS source oracle for historical POS posting journal SHA-256. */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {parse} from 'acorn';

const frozen=readFileSync(new URL('../../legacy/source/SalePayments.gs',import.meta.url),'utf8');
const nodes=parse(frozen,{ecmaVersion:'latest'}).body
  .filter(node=>node.type==='FunctionDeclaration'&&node.id.name==='salePostingPayloadHash_');
if(nodes.length!==1)throw new Error('Frozen sale hash declaration not found');
const exactDeclaration=frozen.slice(nodes[0].start,nodes[0].end);

// GAS returns signed byte integers from Utilities.computeDigest.
// The source masks each signed byte with 255, producing lowercase SHA-256 hex.
const utilities={
  DigestAlgorithm:{SHA_256:'SHA_256'},
  computeDigest:(algorithm,text)=>{
    if(algorithm!=='SHA_256'||typeof text!=='string'){
      throw new Error('Invalid original GAS SHA-256 digest input');
    }
    return [...createHash('sha256').update(text,'utf8').digest()]
      .map(byte=>byte>127?byte-256:byte);
  }
};

export function originalLegacySalePostingPayloadHash(payload){
  const context={Utilities:utilities};
  runInNewContext(exactDeclaration,context);
  return context.salePostingPayloadHash_(payload);
}

export function frozenLegacyHashDeclaration(){
  return exactDeclaration;
}
