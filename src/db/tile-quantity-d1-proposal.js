/**
 * Private M03-only composition of trusted immutable D1 tile revisions and
 * the pure M02 exact Box/Pcs/Sqft quantity contract.
 *
 * A proposal is not stock availability, selected price authority, a customer
 * order, a transaction snapshot or an authorization to post any ledger.
 */
import {readTileMeasurementCandidateD1} from './tile-measurement-d1-read.js';
import {resolveTileQuantityFromCatalog} from '../modules/tile-quantity-contract.js';

/**
 * D1 rows and historical revision are resolved on the server. Callers may
 * request a physical proposal, but never provide pack factors/dimensions.
 */
export async function proposeTileQuantityCandidateD1({
 DB,productId,revision='current',request
}={}){
 const candidate=await readTileMeasurementCandidateD1({DB,productId,revision});
 if(candidate===null)return null;
 const quantity=resolveTileQuantityFromCatalog(
  candidate.catalog,candidate.measurement,request
 );
 return {...candidate,quantity};
}
