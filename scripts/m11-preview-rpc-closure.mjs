/**
 * M11: build the exact, source-pinned closure of original browser RPC targets.
 * These names are only used to prove that the PUBLIC PREVIEW refuses them;
 * the source inventory is never a Worker allowlist or launch permission.
 */
const SOURCE='29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2';
const NAME=/^[A-Za-z][A-Za-z0-9_]{0,79}$/;
const FILE=/^[A-Za-z][A-Za-z0-9_-]*\.(gs|html)$/;
const exact=(obj,keys)=>obj!==null&&typeof obj==='object'&&!Array.isArray(obj)&&
  Object.keys(obj).length===keys.length&&keys.every(key=>Object.hasOwn(obj,key));
const positive=x=>Number.isSafeInteger(x)&&x>0;
const fail=()=>{throw new Error('M11_PREVIEW_INVENTORY_INVALID');};

export function listM11PreviewRpcNames({literalInventory,dynamicClosure,expectedSourceSha}={}){
  if(expectedSourceSha!==SOURCE||
    !exact(literalInventory,['formatVersion','sourceCommit','methodology','counts','rpcs','dynamicCallsites'])||
    literalInventory.formatVersion!==1||literalInventory.sourceCommit!==SOURCE||
    typeof literalInventory.methodology!=='string'||
    !exact(literalInventory.counts,[
      'frontendFiles','backendFiles','literalCallsites','dynamicCallsites','unresolvedNames'
    ])||
    literalInventory.counts.frontendFiles!==37||
    literalInventory.counts.backendFiles!==47||
    literalInventory.counts.literalCallsites!==172||
    literalInventory.counts.dynamicCallsites!==4||
    literalInventory.counts.unresolvedNames!==0||
    !Array.isArray(literalInventory.rpcs)||literalInventory.rpcs.length!==129||
    !Array.isArray(literalInventory.dynamicCallsites)||
    literalInventory.dynamicCallsites.length!==4){
    fail();
  }
  if(!exact(dynamicClosure,[
    'formatVersion','sourceCommit','methodology','counts','callsites'
  ])||dynamicClosure.formatVersion!==1||dynamicClosure.sourceCommit!==SOURCE||
    typeof dynamicClosure.methodology!=='string'||
    !exact(dynamicClosure.counts,[
      'dynamicCallsites','resolvedCallsites','totalTargetAppearances','distinctTargets'
    ])||
    dynamicClosure.counts.dynamicCallsites!==4||
    dynamicClosure.counts.resolvedCallsites!==4||
    dynamicClosure.counts.totalTargetAppearances!==16||
    dynamicClosure.counts.distinctTargets!==16||
    !Array.isArray(dynamicClosure.callsites)||dynamicClosure.callsites.length!==4){
    fail();
  }
  const known=new Set();
  let totalCalls=0;
  for(const row of literalInventory.rpcs){
    if(!exact(row,['name','frontendFiles','callCount','backendFile','status'])||
      !NAME.test(row.name??'')||known.has(row.name)||
      !Array.isArray(row.frontendFiles)||row.frontendFiles.length===0||
      row.frontendFiles.some(f=>typeof f!=='string'||!FILE.test(f)||!f.endsWith('.html'))||
      new Set(row.frontendFiles).size!==row.frontendFiles.length||
      !positive(row.callCount)||
      typeof row.backendFile!=='string'||!FILE.test(row.backendFile)||
      !row.backendFile.endsWith('.gs')||row.status!=='DEFINED')fail();
    known.add(row.name);
    totalCalls+=row.callCount;
  }
  if(totalCalls!==172)fail();

  const dynamicNames=new Set();
  let targetCount=0;
  for(const site of dynamicClosure.callsites){
    if(!exact(site,[
      'frontendFile','line','argumentSyntax','evidence','targets'
    ])||typeof site.frontendFile!=='string'||
      !FILE.test(site.frontendFile)||!site.frontendFile.endsWith('.html')||
      !positive(site.line)||
      typeof site.argumentSyntax!=='string'||site.argumentSyntax.length===0||
      typeof site.evidence!=='string'||site.evidence.length===0||
      !Array.isArray(site.targets)||site.targets.length===0)fail();
    for(const target of site.targets){
      if(!exact(target,['name','backendFile'])||
        !NAME.test(target.name??'')||
        typeof target.backendFile!=='string'||!FILE.test(target.backendFile)||
        !target.backendFile.endsWith('.gs')||
        known.has(target.name)||dynamicNames.has(target.name))fail();
      dynamicNames.add(target.name);
      targetCount++;
    }
  }
  if(dynamicNames.size!==16||targetCount!==16)fail();
  const names=[...known,...dynamicNames].sort();
  if(names.length!==145)fail();
  return names;
}
