/**
 * M10-05 — pure synthetic/offline parity evidence for legacy LOGS.
 * The original LOGS sheet has NO source Log ID; source row positions are
 * provenance, not immutable record identities. Never use positionDigest as
 * M10-01's original-id idDigest or as production migration approval.
 *
 * No source access, D1 binding, remote import, public RPC, or raw log output.
 */
import {createHash} from 'node:crypto';
import {verifyLegacyErrorLogMapping} from '../db/legacy-error-log-mapping.js';
import {prepareSourceLegacyErrorLogs} from '../db/legacy-error-log-import.js';

const INVALID='M10 LOGS evidence invalid';
const GROUP=/^[A-Z][A-Z0-9_]*$/;
const sha=value=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');

/**
 * @returns {{sheetKey:'LOGS',rowCount:number,rowDigest:string,
 *  positionDigest:string,identityKind:'SOURCE_ROW_POSITION_ONLY'}}
 */
export function summarizeM10IdlessLogs({inventory,rows}={}){
  try{
    if(!inventory||inventory.formatVersion!==1||
       !Array.isArray(inventory.tables)||inventory.tables.length!==49)
      throw new Error('Unreviewed source inventory');
    const keys=inventory.tables.map(x=>x?.sheetKey);
    if(keys.some(k=>typeof k!=='string'||!GROUP.test(k))||
       new Set(keys).size!==49)
      throw new Error('Unreviewed duplicate source groups');
    verifyLegacyErrorLogMapping(inventory);
    const records=prepareSourceLegacyErrorLogs(rows);
    const all=records.map(record=>[
      record.legacy_sheet_row,record.timestamp_text,record.context,record.message
    ]);
    const positions=records.map(record=>record.legacy_sheet_row);
    return {
      sheetKey:'LOGS',
      rowCount:records.length,
      rowDigest:sha(['M10-LOGS-ROW-v1','LOGS',all]),
      positionDigest:sha(['M10-LOGS-POSITION-v1','LOGS',positions]),
      identityKind:'SOURCE_ROW_POSITION_ONLY'
    };
  }catch{
    // The source may contain credentials or private operational details.
    // Do not expose source values, hash inputs, internal mapping errors or
    // malicious getter exception messages to GitHub CI or public consumers.
    throw new Error(INVALID);
  }
}
