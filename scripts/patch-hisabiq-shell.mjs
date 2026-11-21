/** Compiled-only HisabIQ application shell: no changes to pinned legacy source. */
const count=(text,anchor)=>text.split(anchor).length-1;

export function patchHisabiqShell(html,css,script){
  if(typeof html!=='string'||typeof css!=='string'||typeof script!=='string')
    throw new TypeError('HisabIQ shell patch requires compiled HTML, CSS and JS');
  if(count(html,'<style data-hisabiq-shell>')===1&&
     count(html,'<script data-hisabiq-shell>')===1)return html;
  for(const marker of ['id="app"','id="sidebar"','id="navList"','id="menuToggle"',
    'id="shopNameLabel"','id="sidebarCollapseBtn"','</head>','</body>']){
    if(count(html,marker)!==1)throw new Error('Missing/ambiguous original shell anchor: '+marker);
  }
  if(count(html,'<style data-hisabiq-shell>')||count(html,'<script data-hisabiq-shell>'))
    throw new Error('Partial HisabIQ shell patch; refusing duplicate scripts');
  if(css.includes('</style>')||script.includes('</script>'))
    throw new Error('Unexpected close tag in inline shell asset');
  return html.replace('</head>','<style data-hisabiq-shell>\n'+css+'\n</style>\n</head>')
    .replace('</body>','<script data-hisabiq-shell>\n'+script+'\n</script>\n</body>');
}
