/**
 * M10-17: offline continuity between the separately validated M10-15
 * source→backup→restore and M10-16 source→replay→rejected-retry packets.
 *
 * This NEVER reads real source data or D1, authenticates external receipts,
 * verifies executed D1 rollback, authorizes migration or approves release.
 */
import {assessM10EvidencePacket} from './m10-evidence-packet.js';
import {assessM10ImportReplayEvidence} from './m10-import-replay-evidence.js';

const BAD='M10 replay packet continuity invalid';
const LIMITATIONS='Two individually matching supplied evidence sets cannot independently prove real source custody, D1 execution, rollback or production readiness';
const ROOT=['packet','replay'];
const fail=()=>{throw new Error(BAD);};

function exactRoot(input){
  if(input===null||typeof input!=='object'||Array.isArray(input)||
      ![Object.prototype,null].includes(Object.getPrototypeOf(input)))fail();
  for(const name of Reflect.ownKeys(input)){
    if(typeof name!=='string'||!ROOT.includes(name))fail();
    const desc=Object.getOwnPropertyDescriptor(input,name);
    if(desc?.enumerable!==true||!Object.hasOwn(desc,'value'))fail();
  }
  return input;
}
function own(obj,key){
  if(obj===null||typeof obj!=='object')fail();
  const d=Object.getOwnPropertyDescriptor(obj,key);
  if(d?.enumerable!==true||!Object.hasOwn(d,'value'))fail();
  return d.value;
}
function arrayIndex(rows){
  if(!Array.isArray(rows)||rows.length!==49)fail();
  const map=new Map();
  for(const row of rows){
    const sheetKey=own(row,'sheetKey');
    if(typeof sheetKey!=='string'||map.has(sheetKey))fail();
    map.set(sheetKey,row);
  }
  return map;
}
/** Called only after BOTH inner validators accept exact canonical group input. */
function compare(a,b,prefix,add){
  const left=arrayIndex(a),right=arrayIndex(b);
  const keys=[...left.keys()];
  if(keys.some(k=>!right.has(k)))fail();
  for(const name of keys){
    const x=left.get(name),y=right.get(name);
    if(own(x,'rowCount')!==own(y,'rowCount'))
      add(prefix+'_ROW_COUNT_MISMATCH');
    if(own(x,'rowDigest')!==own(y,'rowDigest'))
      add(prefix+'_ROW_DIGEST_MISMATCH');
    if(name==='LOGS'){
      if(own(x,'positionDigest')!==own(y,'positionDigest'))
        add(prefix+'_POSITION_DIGEST_MISMATCH');
    }else if(own(x,'idDigest')!==own(y,'idDigest'))
      add(prefix+'_ID_DIGEST_MISMATCH');
  }
}
/**
 * All fields are candidate-only. No original IDs, source group labels, rows,
 * digests, customer/Party values or input capture identifiers are returned.
 */
export function assessM10ReplayPacketContinuity(input={}){
  try{
    const evidence=exactRoot(input);
    const issues=new Map();
    const add=(code,n=1)=>{if(n>0)issues.set(code,(issues.get(code)||0)+n)};
    const packet=Object.hasOwn(evidence,'packet')?own(evidence,'packet'):undefined;
    const replay=Object.hasOwn(evidence,'replay')?own(evidence,'replay'):undefined;
    if(packet===undefined)add('CONTINUITY_PACKET_MISSING');
    if(replay===undefined)add('CONTINUITY_REPLAY_MISSING');

    const packetCandidate=packet===undefined?false:
      assessM10EvidencePacket(packet).candidateEvidenceComplete===true;
    const replayCandidate=replay===undefined?false:
      assessM10ImportReplayEvidence(replay).candidateReplayEvidence===true;
    if(packet!==undefined&&!packetCandidate)
      add('CONTINUITY_PACKET_NOT_READY');
    if(replay!==undefined&&!replayCandidate)
      add('CONTINUITY_REPLAY_NOT_READY');

    let groupsLinked=false;
    if(packetCandidate&&replayCandidate){
      // Each M10 module already rejects noncanonical/duplicate/missing
      // source groups. This only enforces the continuity between modules.
      const rehearsal=own(packet,'rehearsal');
      const restore=own(packet,'restore');
      const freeze=own(rehearsal,'sourceFreeze');
      compare(own(replay,'source').groups,own(rehearsal,'sourceSummary'),
        'CONTINUITY_SOURCE',add);
      compare(own(replay,'replayedImport').groups,own(rehearsal,'d1Summary'),
        'CONTINUITY_D1',add);
      compare(own(replay,'rejectedRetryReadback').groups,
        own(restore,'backup').groups,'CONTINUITY_BACKUP',add);

      if(own(replay,'source').capturedAt<
        own(freeze,'secondPass').capturedAt)
        add('CONTINUITY_REPLAY_SOURCE_BEFORE_FREEZE');
      if(own(replay,'rejectedRetryReadback').capturedAt>
        own(restore,'backup').capturedAt)
        add('CONTINUITY_BACKUP_BEFORE_REJECTED_READBACK');

      const ids=[
        own(freeze,'firstPass').snapshotId,
        own(freeze,'secondPass').snapshotId,
        own(replay,'source').captureId,
        own(replay,'firstImport').captureId,
        own(replay,'replayedImport').captureId,
        own(replay,'rejectedRetryReadback').captureId,
        own(restore,'backup').captureId,
        own(restore,'restored').captureId
      ];
      if(new Set(ids).size!==ids.length)
        add('CONTINUITY_CAPTURE_ID_REUSED');
      groupsLinked=![...issues.keys()].some(x=>
        /_ROW_COUNT_MISMATCH$|_ROW_DIGEST_MISMATCH$|_ID_DIGEST_MISMATCH$|_POSITION_DIGEST_MISMATCH$/.test(x));
    }

    const sorted=[...issues].sort(([a],[b])=>a<b?-1:a>b?1:0)
      .map(([code,count])=>({code,count}));
    return {
      formatVersion:1,phase:'M10_OFFLINE_REPLAY_PACKET_CONTINUITY',
      packetCandidate,replayCandidate,groupsLinked,
      candidateCrossGateContinuity:packetCandidate&&replayCandidate&&
        groupsLinked&&sorted.length===0,
      authorizesImport:false,authorizesPosting:false,
      authorizesRestore:false,authorizesCutover:false,productionReady:false,
      issues:sorted,limitations:LIMITATIONS
    };
  }catch{
    // Never echo input, nested error, source ID, digest or opaque token.
    throw new Error(BAD);
  }
}
