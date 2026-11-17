/**
 * M03 private staging-only source archive preflight.
 * NOT exported by the public Worker/RPC registry and never returns business rows.
 * HISTORY_ARCHIVE is separate from the operational tenant-scoped DB.
 *
 * A D1 binding is writable by the Worker principal. Do not call write methods
 * here and do not expose this adapter on a route until reviewed M04 authority.
 */
export async function inspectPrivateHistoryArchive(env){
 if(!env?.DB||typeof env.DB.prepare!=='function'||
    !env.HISTORY_ARCHIVE||typeof env.HISTORY_ARCHIVE.prepare!=='function'||
    env.DB===env.HISTORY_ARCHIVE){
  throw new Error('Private history archive binding unavailable');
 }
 const DB=env.HISTORY_ARCHIVE;
 const sheets=await DB.prepare(
  'SELECT COUNT(*) AS total_sheets, COALESCE(SUM(populated_data_rows),0) AS populated_rows, '+
  'COALESCE(SUM(physical_data_rows),0) AS physical_rows FROM archive_sheets'
 ).first();
 const parts=await DB.prepare(
  'SELECT COUNT(*) AS workbook_chunks FROM archive_source_parts'
 ).first();
 const integers=[sheets?.total_sheets,sheets?.populated_rows,
  sheets?.physical_rows,parts?.workbook_chunks];
 if(integers.some(x=>!Number.isSafeInteger(x)||x<0)||
    sheets.total_sheets!==50||sheets.populated_rows>sheets.physical_rows||
    parts.workbook_chunks!==12){
  throw new Error('Private history archive integrity/count preflight failed');
 }
 return {
  status:'private-staging-archive-verified',
  sourceGroups:49,sheets:sheets.total_sheets,
  populatedRows:sheets.populated_rows,physicalRows:sheets.physical_rows,
  workbookParts:parts.workbook_chunks,
  operationalImportAuthorized:false,publicRpcEnabled:false
 };
}
