import test from 'node:test';
import assert from 'node:assert/strict';
import {calculateCoverage,activeMasterUnits} from '../../src/ui/hisabiq/add-product-unit-editor.mjs';
import {patchOwnerHisabiqUnitEditor} from '../../scripts/patch-owner-hisabiq-unit-editor.mjs';

test('joined Box/Pcs and Pcs/Sqft equations calculate exact per-pack and opening coverage',()=>{
 const output=calculateCoverage({packSize:'15',coveragePerPiece:'.65',openingPacks:'2',openingPieces:'5'});
 assert.equal(output.equation,'1 Box = 15 Pcs');
 assert.equal(output.areaEquation,'1 Pcs = 0.65 Sqft');
 assert.equal(output.packCoverage,'9.75');
 assert.equal(output.openingBase,'35');
 assert.equal(output.openingCoverage,'22.75');
 assert.equal(calculateCoverage({packSize:'15',coveragePerPiece:'.65',openingPacks:'0',openingPieces:'0'}).openingCoverage,'0');
 assert.equal(calculateCoverage({packSize:'15',coveragePerPiece:'0.0001',openingPacks:'0',openingPieces:'1'}).openingCoverage,'0.0001');
});

test('invalid ratios and count or imprecise coverage fail closed, without scientific notation',()=>{
 for(const value of ['','0','-0.65','NaN','1e2','2.12345','.','  .65x','Infinity','1000001']){
   assert.throws(()=>calculateCoverage({packSize:'15',coveragePerPiece:value,openingPacks:'2',openingPieces:'5'}),/coverage|ratio|positive|decimal/i,value);
 }
 for(const value of ['0','1.5','-1','1e3','1000001','']){
   assert.throws(()=>calculateCoverage({packSize:value,coveragePerPiece:'.65',openingPacks:'2',openingPieces:'5'}),/pack|whole|positive/i,value);
 }
 assert.throws(()=>calculateCoverage({packSize:'15',coveragePerPiece:'.65',openingPacks:'-1',openingPieces:'5'}),/opening/i);
});

test('managed unit list excludes inactive and duplicate source names, never synthesizes a new master unit',()=>{
 assert.deepEqual(activeMasterUnits([
   {name:'Pcs',status:'Active'},{name:'Box',status:'Active'},
   {name:'box',Status:'Active'},{name:'Carton',status:'Inactive'},{name:'Sqft',status:'Active'},
   {name:'Unsafe',status:'Deleted'}, {name:''}
 ]),['Pcs','Box','Sqft']);
 assert.deepEqual(activeMasterUnits([]),[]);
});

test('Owner patch is additive, idempotence protected and never injected without Add Product boundary',()=>{
 const html='<html><head></head><body><div class="modal-overlay" id="prodModal"></div><select id="prodUnit"></select><button id="prodSaveBtn"></button></body></html>';
 const added=patchOwnerHisabiqUnitEditor(html,{css:'.hapu-editor{display:block}',js:'console.info("unit-editor")'});
 assert.match(added,/id="hisabiq-owner-unit-editor-style"/);
 assert.match(added,/id="hisabiq-owner-unit-editor"/);
 assert.match(added,/id="prodModal"/);
 assert.throws(()=>patchOwnerHisabiqUnitEditor(added,{css:'x',js:'x'}),/already/i);
 assert.throws(()=>patchOwnerHisabiqUnitEditor('<html><head></head><body></body></html>',{css:'x',js:'x'}),/boundary/i);
});
