import {readFile} from 'node:fs/promises';

/** Owner-only Add Product progressive enhancement; frozen legacy source stays unchanged. */
export function patchOwnerHisabiqUnitEditor(html,{css,js}={}){
 if(typeof html!=='string'||typeof css!=='string'||!css.trim()||typeof js!=='string'||!js.trim())
   throw new TypeError('Missing HisabIQ Add Product assets');
 for(const boundary of ['id="prodModal"','id="prodUnit"','id="prodSaveBtn"','</head>','</body>']){
   if(html.split(boundary).length!==2)throw new Error('Original Add Product boundary changed: '+boundary);
 }
 if(html.includes('id="hisabiq-owner-unit-editor"'))throw new Error('HisabIQ Owner unit editor already installed');
 if(/<\/style/i.test(css)||/<\/script/i.test(js))throw new Error('Unsafe inline Add Product asset');
 return html.replace('</head>',`<style id="hisabiq-owner-unit-editor-style">\n${css}\n</style>\n</head>`)
   .replace('</body>',`<script type="module" id="hisabiq-owner-unit-editor">\n${js}\n</script>\n</body>`);
}

export async function installOwnerHisabiqUnitEditor(html){
 const root=new URL('../src/ui/hisabiq/',import.meta.url);
 const [css,js]=await Promise.all([
   readFile(new URL('add-product-unit-editor.css',root),'utf8'),
   readFile(new URL('add-product-unit-editor.mjs',root),'utf8'),
 ]);
 return patchOwnerHisabiqUnitEditor(html,{css,js});
}
