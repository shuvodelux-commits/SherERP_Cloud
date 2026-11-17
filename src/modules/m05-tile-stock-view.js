/**
 * M05 internal read-only tile stock view.
 *
 * Converts an already trusted canonical signed Pcs stock balance into a
 * source-preserving Box/Carton + Pcs breakdown and exact Sqft, using the
 * reviewed M02 tile quantity contract. No D1 read, inventory reservation,
 * posting permission, supplier/Party/Cash/Bank or RPC side effects.
 *
 * Source: Mohim_ERP@29aa4a5c7a7062a49e6bf4758beda3a8d62d9ff2
 * and approved sherERP_Mohim@590adfad128fe7155bfb7b608a2ed5665b202a9c.
 * M03/M04 integration must independently verify tenant identity, stock and
 * revision inside its authorized query/posting boundary.
 */
import {resolveTileQuantityFromCatalog} from './tile-quantity-contract.js';

const MAX_PCS=BigInt(Number.MAX_SAFE_INTEGER);
const WHOLE_PCS=/^(?:0|[1-9][0-9]*|-[1-9][0-9]*)$/u;

function canonicalPcs(value){
  if(typeof value!=='string'||!WHOLE_PCS.test(value))
    throw new TypeError('Canonical tile stock Pcs must be a signed whole integer string');
  const quantity=BigInt(value);
  if(quantity>MAX_PCS||quantity< -MAX_PCS)
    throw new RangeError('Tile stock Pcs exceeds safe integer compatibility');
  return quantity;
}

function signedArea(area,stock){
  if(stock===0n)return {numerator:'0',denominator:'1'};
  return {
    numerator:stock<0n?'-'+area.numerator:area.numerator,
    denominator:area.denominator
  };
}

/**
 * Input must be a tenant-scoped, server-trusted physical stock snapshot.
 * Quantities shown for OVERSOLD entries are shortage MAGNITUDES, never stock
 * availability or permission to allocate inventory.
 */
export function projectTileStockView(catalog,measurement,basePcsText){
  const stock=canonicalPcs(basePcsText);
  const magnitude=stock<0n?-stock:stock;
  // The underlying source contract rejects a zero pack. Use exactly one
  // positive Pcs solely to validate catalog/revision provenance in that case,
  // and project ZERO below without treating the witness as stock.
  const checked=resolveTileQuantityFromCatalog(catalog,measurement,{
    mode:'pack',boxes:'0',
    extraPieces:String(magnitude===0n?1n:magnitude)
  });
  const zero=stock===0n;
  return {
    mode:'read-only-stock-view',
    productId:checked.measurementSnapshot.productId,
    revision:checked.measurementSnapshot.revision,
    basePcs:basePcsText,
    stockState:zero?'zero':stock<0n?'oversold':'available',
    boxes:zero?'0':checked.boxes,
    extraPieces:zero?'0':checked.extraPieces,
    packUnitName:checked.measurementSnapshot.boxUnitName,
    actualSqft:signedArea(checked.actualSqft,stock),
    nominalSqft:signedArea(checked.nominalSqft,stock),
    displaySqft:zero?'0.00':stock<0n?'-'+checked.displaySqft:checked.displaySqft,
    measurementSnapshot:checked.measurementSnapshot,
    postingAllowed:false
  };
}
