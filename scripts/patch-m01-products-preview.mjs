#!/usr/bin/env node
import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';

const MARKER='<script type="module" src="/m05-products/m01-products-preview-controller.mjs"></script>';
const MODULES=[
  'm05-product-form-stock-preview.js',
  'm05-product-unit-price-profile.js',
  'm05-tile-stock-view.js',
  'product-unit-conversions.js',
  'tile-quantity-contract.js'
];
const count=(source,phrase)=>source.split(phrase).length-1;

export function patchM01ProductsPreview(html){
  if(typeof html!=='string')throw new TypeError('Missing compiled Products HTML');
  for(const anchor of ['id="prodModal"','id="prodTableBody"','</body>']){
    if(count(html,anchor)!==1)
      throw new Error('Original Products HTML anchor missing, duplicate or ambiguous: '+anchor);
  }
  if(count(html,MARKER)>1)
    throw new Error('Duplicate Products preview module installation');
  if(count(html,MARKER)===1)return html;
  return html.replace('</body>','  '+MARKER+'\n</body>');
}

/** Copy audited read-only ESM graph, without changing source or posting. */
export async function installM01ProductsPreviewAssets(outputDir){
  const dest=join(resolve(outputDir),'m05-products');
  await mkdir(dest,{recursive:true});
  const srcRoot=new URL('../src/modules/',import.meta.url);
  for(const name of MODULES)
    await copyFile(new URL(name,srcRoot),join(dest,name));
  await copyFile(new URL('../src/ui/m01-products-preview-controller.mjs',import.meta.url),
    join(dest,'m01-products-preview-controller.mjs'));
  return dest;
}

if(process.argv[1]&&resolve(process.argv[1])===new URL(import.meta.url).pathname){
  const path=resolve(process.argv[2]||'dist/index.html');
  try{
    const html=await readFile(path,'utf8');
    const patched=patchM01ProductsPreview(html);
    await installM01ProductsPreviewAssets(resolve(path,'..'));
    await writeFile(path,patched,'utf8');
    console.log('M01 Products units/Tiles preview assets installed (read-only): '+path);
  }catch(error){
    console.error('M01 Products preview patch failed: '+error.message);
    process.exitCode=1;
  }
}
