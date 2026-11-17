// Synthetic SQL test data only. No approved manufacturer or business export.
export const columns=[
  'product_id','revision','box_conversion_id','length_text','width_text',
  'dimension_unit','pieces_per_box','coverage_policy',
  'manufacturer_sqft_per_box_text','manufacturer_evidence_ref',
  'purchase_pricing_unit','selling_pricing_unit',
  'purchase_sqft_price_override_text','selling_sqft_price_override_text',
  'source_evidence_ref','created_at_text'
];
export const insertSql='INSERT INTO product_tile_measurement_revisions ('+
  columns.join(',')+') VALUES ('+columns.map(()=>'?').join(',')+')';
export const row=(productId,patch={})=>({
  product_id:productId,revision:1,box_conversion_id:'CTN',length_text:'12',
  width_text:'8',dimension_unit:'in',pieces_per_box:25,coverage_policy:'nominal',
  manufacturer_sqft_per_box_text:null,manufacturer_evidence_ref:null,
  purchase_pricing_unit:'Box',selling_pricing_unit:'Sqft',
  purchase_sqft_price_override_text:null,selling_sqft_price_override_text:'38.0000',
  source_evidence_ref:'synthetic-label:001',created_at_text:'2026-11-17 local',
  ...patch
});
export const values=value=>columns.map(key=>value[key]);
export const seedSql=(productId,revision=1,factor='25.000',base='Pcs',type='')=>[
  {sql:'INSERT INTO products(product_id,source_profile,product_name,base_unit_name,product_type_text) VALUES(?,?,?,?,?)',args:[productId,'new','Synthetic tile',base,type]},
  {sql:'INSERT INTO product_unit_profiles(product_id,revision,stock_unit_name) VALUES(?,?,?)',args:[productId,revision,base]},
  {sql:'INSERT INTO product_unit_conversions(product_id,revision,conversion_id,unit_name,factor_text) VALUES(?,?,?,?,?)',args:[productId,revision,'CTN','Carton',factor]}
];
export const invalidRows=[
  {length_text:'0'},{width_text:'0.000'},{length_text:'-12'},
  {length_text:'+12'},{length_text:'1e2'},{length_text:' 12'},
  {length_text:'12 '},{length_text:'01'},{length_text:'.5'},
  {length_text:'1.'},{length_text:'1.2.3'},{length_text:''},
  {length_text:'1.0000000000001'},{width_text:'9'.repeat(25)},
  {dimension_unit:'feet'},{pieces_per_box:0},{pieces_per_box:-1},
  {pieces_per_box:25.5},{pieces_per_box:'9007199254740992'},
  {coverage_policy:'automatic'},{coverage_policy:'manufacturer'},
  {manufacturer_sqft_per_box_text:'16.668'},
  {manufacturer_evidence_ref:'synthetic-label'},
  {manufacturer_sqft_per_box_text:'0',manufacturer_evidence_ref:'label'},
  {manufacturer_sqft_per_box_text:'16.668',manufacturer_evidence_ref:' '},
  {purchase_pricing_unit:'Carton'},{selling_pricing_unit:'Unknown'},
  {purchase_sqft_price_override_text:'-1'},
  {selling_sqft_price_override_text:'38.0000000000001'},
  {selling_sqft_price_override_text:'NaN'},
  {source_evidence_ref:''},{created_at_text:''}
];
