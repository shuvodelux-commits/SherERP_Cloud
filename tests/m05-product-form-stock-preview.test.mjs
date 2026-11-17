import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  previewM05ProductAddForm,
  formatM05ProductStockCell,
  previewM05TileAreaOpening
} from '../src/modules/m05-product-form-stock-preview.js';

const units=()=>[
  {'Unit Name':'Bag',Status:'Active'},
  {'Unit Name':'Box',Status:'Active'},
  {'Unit Name':'Pcs',Status:'Active'},
  {'Unit Name':'Feet',Status:'Active'}
];
const box=()=>[{leftQty:1,leftUnit:'Box',rightQty:20,rightUnit:'Pcs'}];
const bag=()=>[
  {leftQty:1,leftUnit:'Bag',rightQty:5,rightUnit:'Box'},
  {leftQty:1,leftUnit:'Box',rightQty:20,rightUnit:'Pcs'}
];
const price=(extra={})=>({
  purchasePrice:100,sellingPrice:160,
  purchasePriceUnit:'Box',sellingPriceUnit:'Box',
  unitPriceOverrides:[],...extra
});
const tiles=()=>({
  productId:'T-24',revision:'1',baseUnit:'Pcs',
  boxConversionId:'BOX-25',boxUnitName:'Box',
  length:'24',width:'24',dimensionUnit:'in',
  piecesPerBox:'25',coveragePolicy:'nominal'
});
const tileRelations=()=>[{leftQty:1,leftUnit:'Box',rightQty:25,rightUnit:'Pcs'}];
const ordinary=(extra={})=>({
  productId:'P-CABLE',unitMasters:units(),unitRelations:box(),
  openingUnits:[{unitName:'Box',qtyText:'2'},{unitName:'Pcs',qtyText:'5'}],
  prices:price(),...extra
});
const tileInput=(extra={})=>({
  productId:'T-24',unitMasters:units(),unitRelations:tileRelations(),
  openingUnits:[{unitName:'Box',qtyText:'5'},{unitName:'Pcs',qtyText:'3'}],
  prices:price(),tileMeasurement:tiles(),...extra
});
const cell=(extra={})=>({
  productId:'P-CABLE',unitMasters:units(),unitRelations:box(),
  baseStockText:'45',...extra
});

test('Add Product 2 Box 5 Pcs produces canonical 45 Pcs with compact product table text',()=>{
  const value=previewM05ProductAddForm(ordinary());
  assert.equal(value.mode,'read-only-product-add-preview');
  assert.equal(value.productId,'P-CABLE');
  assert.equal(value.baseStock,'45');
  assert.equal(value.stockUnit,'Pcs');
  assert.equal(value.stockCellText,'2 Box 5 Pcs');
  assert.equal(value.postingAllowed,false);
  assert.equal(value.stockAuthority,'snapshot-only');
  assert.deepEqual(value.openingSnapshot,[
    {unitName:'Box',qtyText:'2',factor:'20'},
    {unitName:'Pcs',qtyText:'5',factor:'1'}
  ]);
  assert.equal(value.priceSnapshot.purchasePriceUnit,'Box');
  assert.equal(value.priceSnapshot.purchaseBasePrice,5);
  assert.equal(value.priceSnapshot.sellingBasePrice,8);
});

test('connected 1 Bag=5 Box=100 Pcs chain shows 1 Bag 2 Box 5 Pcs for 145 Pcs',()=>{
  const v=previewM05ProductAddForm(ordinary({
    unitRelations:bag(),
    openingUnits:[
      {unitName:'Bag',qtyText:'1'},
      {unitName:'Box',qtyText:'2'},
      {unitName:'Pcs',qtyText:'5'}
    ],
    prices:price({purchasePrice:500,sellingPrice:800,
      purchasePriceUnit:'Bag',sellingPriceUnit:'Bag'})
  }));
  assert.equal(v.baseStock,'145');
  assert.equal(v.stockCellText,'1 Bag 2 Box 5 Pcs');
  assert.deepEqual(v.conversions.map(x=>[x.unitName,x.factor]),[['Bag',100],['Box',20]]);
  assert.equal(v.priceSnapshot.purchaseBasePrice,5);
  assert.equal(v.priceSnapshot.sellingBasePrice,8);
});

test('independently specified anchor price and per-unit override stay lossless',()=>{
  const v=previewM05ProductAddForm(ordinary({
    prices:price({
      purchasePrice:70,sellingPrice:90,
      unitPriceOverrides:[{unitName:'Pcs',purchasePrice:4.375,sellingPrice:5.625}]
    })
  }));
  assert.equal(v.priceSnapshot.purchasePriceUnit,'Box');
  assert.equal(v.priceSnapshot.purchaseBasePrice,3.5);
  assert.equal(v.priceSnapshot.stockPurchaseOverride,4.375);
  assert.equal(v.priceSnapshot.stockSellingOverride,5.625);
  assert.equal(v.priceSnapshot.conversions[0].purchasePrice,70);
});

test('Tiles Add Product 5 Box 3 Pcs is 128 physical Pcs and 512.00 actual Sqft for 24x24',()=>{
  const v=previewM05ProductAddForm(tileInput());
  assert.equal(v.baseStock,'128');
  assert.equal(v.stockCellText,'5 Box 3 Pcs · 512.00 Sqft');
  assert.equal(v.tile.actualSqft.numerator,'512');
  assert.equal(v.tile.actualSqft.denominator,'1');
  assert.equal(v.tile.displaySqft,'512.00');
  assert.equal(v.tile.revision,'1');
  assert.equal(v.postingAllowed,false);
});

test('Tiles entered 355.00 Sqft rounds UP to 89 physical Pcs, displays 356.00 actual',()=>{
  const v=previewM05TileAreaOpening({
    productId:'T-24',unitMasters:units(),unitRelations:tileRelations(),
    tileMeasurement:tiles(),requestedSqft:'355.00',fulfillment:'loose'
  });
  assert.equal(v.requestedSqft,'355.00');
  assert.equal(v.baseStock,'89');
  assert.equal(v.stockCellText,'3 Box 14 Pcs · 356.00 Sqft');
  assert.deepEqual(v.tile.actualSqft,{numerator:'356',denominator:'1'});
  assert.equal(v.postingAllowed,false);
});

test('Tiles area box-only fulfillment rounds to 100 Pcs rather than inventing missing area',()=>{
  const v=previewM05TileAreaOpening({
    productId:'T-24',unitMasters:units(),unitRelations:tileRelations(),
    tileMeasurement:tiles(),requestedSqft:'355.00',fulfillment:'box-only'
  });
  assert.equal(v.baseStock,'100');
  assert.equal(v.stockCellText,'4 Box · 400.00 Sqft');
});

test('verified manufacturer coverage is distinct from nominal dimension-derived coverage',()=>{
  const measured={...tiles(),coveragePolicy:'manufacturer',
    manufacturerSqftPerBox:'16.668',manufacturerEvidence:'supplier-label-2026'};
  const v=previewM05ProductAddForm(tileInput({
    tileMeasurement:measured,
    openingUnits:[{unitName:'Box',qtyText:'18'},{unitName:'Pcs',qtyText:'0'}]
  }));
  assert.equal(v.baseStock,'450');
  assert.equal(v.tile.displaySqft,'300.02');
  assert.deepEqual(v.tile.actualSqft,{numerator:'37503',denominator:'125'});
  assert.deepEqual(v.tile.nominalSqft,{numerator:'1800',denominator:'1'});
  assert.equal(v.tile.measurementSnapshot.manufacturerEvidence,'supplier-label-2026');
});

test('Products stock display consumes canonical already-trusted base stock without inventing opening stock',()=>{
  const v=formatM05ProductStockCell(cell());
  assert.equal(v.baseStock,'45');
  assert.equal(v.stockCellText,'2 Box 5 Pcs');
  assert.equal(v.stockState,'available');
  assert.equal(v.postingAllowed,false);
});

test('Products stock table reports OVERSOLD shortages, never sellable stock',()=>{
  const v=formatM05ProductStockCell(cell({baseStockText:'-45'}));
  assert.equal(v.stockState,'oversold');
  assert.equal(v.stockCellText,'Shortage: 2 Box 5 Pcs');
  assert.equal(v.postingAllowed,false);
  assert.equal(formatM05ProductStockCell(cell({baseStockText:'0'})).stockCellText,'0 Pcs');
});

test('zero base-unit remainder suppresses redundant Pcs, and single-unit source products remain supported',()=>{
  assert.equal(formatM05ProductStockCell(cell({baseStockText:'40'})).stockCellText,'2 Box');
  assert.equal(formatM05ProductStockCell({
    productId:'S-1',unitMasters:units(),unitRelations:[],baseUnit:'Feet',
    baseStockText:'12'
  }).stockCellText,'12 Feet');
});

test('new Product Add must reject opening negative stock, malformed quantities and duplicate opening units',()=>{
  for(const bad of ['-1','1.5','01','1e2',' 2','9007199254740992']){
    assert.throws(()=>previewM05ProductAddForm(ordinary({
      openingUnits:[{unitName:'Box',qtyText:bad}]
    })),/quantity|canonical|integer|stock|range/i);
  }
  assert.throws(()=>previewM05ProductAddForm(ordinary({
    openingUnits:[{unitName:'Box',qtyText:'2'},{unitName:'Box',qtyText:'1'}]
  })),/duplicate.*unit/i);
});

test('missing, inactive, duplicated, circular or disconnected unit chains reject',()=>{
  assert.throws(()=>previewM05ProductAddForm(ordinary({
    unitMasters:units().map(x=>x['Unit Name']==='Box'?{...x,Status:'Inactive'}:x)
  })),/active.*unit|must be an active/i);
  assert.throws(()=>previewM05ProductAddForm(ordinary({
    unitMasters:[...units(),{'Unit Name':'Box',Status:'Active'}]
  })),/duplicate.*unit/i);
  assert.throws(()=>previewM05ProductAddForm(ordinary({
    unitRelations:[{leftQty:1,leftUnit:'Box',rightQty:20,rightUnit:'Box'}]
  })),/different unit|same/i);
  assert.throws(()=>previewM05ProductAddForm(ordinary({
    unitRelations:[...box(),{leftQty:1,leftUnit:'Bag',rightQty:5,rightUnit:'Box'}]
  })),/connected chain/i);
});

test('Tile pack mismatch or stale measurement identity refuses calculated Sqft',()=>{
  assert.throws(()=>previewM05ProductAddForm(tileInput({
    tileMeasurement:{...tiles(),piecesPerBox:'24'}
  })),/pack.*mismatch|tile.*mismatch/i);
  assert.throws(()=>previewM05ProductAddForm(tileInput({
    tileMeasurement:{...tiles(),productId:'SOMEONE-ELSE'}
  })),/product|identity|mismatch/i);
  assert.throws(()=>previewM05ProductAddForm(tileInput({
    tileMeasurement:{...tiles(),coveragePolicy:'manufacturer'}
  })),/manufacturer|evidence/i);
});

test('untrusted additions and accessor-bearing values reject without invoking getters',()=>{
  const invalid=Object.defineProperty({},'productId',{get(){throw Error('getter executed');}});
  assert.throws(()=>previewM05ProductAddForm(invalid),/record|accessor|input/i);
  assert.throws(()=>previewM05ProductAddForm(ordinary({postingAllowed:true})),/unsupported|unexpected/i);
  const rel=Object.defineProperty({},'leftUnit',{get(){throw Error('getter executed');}});
  assert.throws(()=>previewM05ProductAddForm(ordinary({unitRelations:[rel]})),/record|accessor|input/i);
});

test('invalid prices are rejected before normalization, and no public Worker/RPC handler is added',()=>{
  assert.throws(()=>previewM05ProductAddForm(ordinary({
    prices:price({purchasePrice:-1})
  })),/price|number/i);
  const runtime=readFileSync(new URL('../src/rpc/registry.js',import.meta.url),'utf8')+
    readFileSync(new URL('../src/index.js',import.meta.url),'utf8');
  assert.doesNotMatch(runtime,/previewM05ProductAddForm|formatM05ProductStockCell|previewM05TileAreaOpening/);
  const module=readFileSync(new URL('../src/modules/m05-product-form-stock-preview.js',import.meta.url),'utf8');
  assert.doesNotMatch(module,/\bINSERT\s+INTO\b|\bUPDATE\s+\w+\s+SET\b|\bDELETE\s+FROM\b|\.batch\s*\(|\.run\s*\(/iu);
});


test('Tiles Carton to Box to Pcs chain retains whole-piece stock and area',()=>{
  const relations=[
    {leftQty:1,leftUnit:'Carton',rightQty:10,rightUnit:'Box'},
    {leftQty:1,leftUnit:'Box',rightQty:25,rightUnit:'Pcs'}
  ];
  const value=previewM05ProductAddForm(tileInput({
    unitMasters:[...units(),{'Unit Name':'Carton',Status:'Active'}],
    unitRelations:relations,
    openingUnits:[
      {unitName:'Carton',qtyText:'2'},
      {unitName:'Box',qtyText:'5'},
      {unitName:'Pcs',qtyText:'3'}
    ]
  }));
  assert.equal(value.baseStock,'628');
  assert.equal(value.stockCellText,'2 Carton 5 Box 3 Pcs · 2512.00 Sqft');
  assert.deepEqual(value.conversions.map(x=>[x.unitName,x.factor]),[
    ['Carton',250],['Box',25]
  ]);
  assert.equal(value.tile.displaySqft,'2512.00');
  assert.equal(value.postingAllowed,false);
});

test('a current Tile Carton shortage remains negative with no physical stock authority',()=>{
  const value=formatM05ProductStockCell({
    productId:'T-24',
    unitMasters:[...units(),{'Unit Name':'Carton',Status:'Active'}],
    unitRelations:[
      {leftQty:1,leftUnit:'Carton',rightQty:10,rightUnit:'Box'},
      {leftQty:1,leftUnit:'Box',rightQty:25,rightUnit:'Pcs'}
    ],
    baseStockText:'-628',tileMeasurement:tiles()
  });
  assert.equal(value.stockState,'oversold');
  assert.equal(value.stockCellText,'Shortage: 2 Carton 5 Box 3 Pcs · 2512.00 Sqft');
  assert.equal(value.postingAllowed,false);
});
