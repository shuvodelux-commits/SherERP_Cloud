/**
 * M01 Reports Print safety — intentionally unimplemented RED baseline.
 * The original compiled Reports are left unchanged until test-first proof.
 */
export function patchM01ReportPrintSafety(html,controller){
  if(typeof html!=='string'||typeof controller!=='string')
    throw new TypeError('Missing compiled Reports HTML or controller');
  return html;
}
