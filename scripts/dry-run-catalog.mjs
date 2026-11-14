#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { prepareCatalogImport } from '../src/db/catalog-import.js';

async function main() {
  const requested = process.argv[2];
  if (!requested) throw new Error('Supply an explicit local JSON source file path');
  const [inventoryText, sourceText] = await Promise.all([
    readFile(resolve('docs/baseline/schema-inventory.json'), 'utf8'),
    readFile(resolve(requested), 'utf8')
  ]);
  const result=prepareCatalogImport(JSON.parse(inventoryText),JSON.parse(sourceText));
  process.stdout.write(JSON.stringify(result.summary,null,2)+'\n');
}
main().catch(error=>{
  console.error('Catalog dry run rejected: '+error.message);
  process.exitCode=1;
});
