/**
 * Internal M02 tiles quantity contract. No D1, RPC, stock or money posting.
 * Consumes a caller-supplied trusted immutable measurement revision; a future
 * authorized D1 adapter must verify its product/profile/pack relationship.
 * Physical quantities reuse the approved supplementary unit resolver. Area
 * and selected-unit pricing stay exact until the proposed line rounding.
 */
import {resolveProductUnitBreakdown_} from './product-unit-conversions.js';

const SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
const MEASUREMENT_FIELDS = [
  'productId', 'revision', 'baseUnit', 'boxConversionId', 'length', 'width',
  'dimensionUnit', 'piecesPerBox', 'coveragePolicy',
  'manufacturerSqftPerBox', 'manufacturerEvidence'
];

function record(value, allowed) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new TypeError('Explicit tile contract record required');
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!allowed.includes(key) || !descriptor.enumerable ||
        !Object.hasOwn(descriptor, 'value'))
      throw new TypeError('Invalid or ambiguous tile contract field');
  }
}

function identity(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim() ||
      value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value))
    throw new TypeError('Invalid tile ' + label);
  return value;
}

function gcd(a, b) {
  while (b) [a, b] = [b, a % b];
  return a;
}

function fraction(n, d = 1n) {
  const divisor = gcd(n, d);
  return {n: n / divisor, d: d / divisor};
}
const multiply = (a, b) => fraction(a.n * b.n, a.d * b.d);
const divide = (a, b) => fraction(a.n * b.d, a.d * b.n);
const serialize = a => ({numerator: String(a.n), denominator: String(a.d)});
const ceil = a => (a.n + a.d - 1n) / a.d;
const roundMinor = a => (a.n * 200n + a.d) / (a.d * 2n);

function decimal(text, label, positive = false) {
  if (typeof text !== 'string' ||
      !/^(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$/u.test(text))
    throw new TypeError('Invalid exact decimal for tile ' + label);
  const [whole, part = ''] = text.split('.');
  const value = fraction(BigInt(whole + part), 10n ** BigInt(part.length));
  if (positive && value.n === 0n)
    throw new RangeError('Tile ' + label + ' must be positive');
  return value;
}

function integer(text, label, positive = false) {
  if (typeof text !== 'string' || !/^(?:0|[1-9][0-9]{0,23})$/u.test(text))
    throw new TypeError('Invalid whole number for tile ' + label);
  const value = BigInt(text);
  if (positive && value === 0n)
    throw new RangeError('Tile ' + label + ' must be positive');
  if (value > SAFE_INTEGER)
    throw new RangeError('Tile ' + label + ' exceeds safe integer compatibility');
  return value;
}

function display(a) {
  const minor = roundMinor(a);
  return String(minor / 100n) + '.' + String(minor % 100n).padStart(2, '0');
}

function measurement(config) {
  record(config, MEASUREMENT_FIELDS);
  identity(config.productId, 'product identity');
  identity(config.boxConversionId, 'box conversion identity');
  if (config.boxConversionId === 'BASE' ||
      Object.hasOwn(Object.prototype, config.boxConversionId))
    throw new TypeError('Invalid tile box conversion identity');
  integer(config.revision, 'revision', true);
  const pack = integer(config.piecesPerBox, 'pieces per box', true);
  if (config.baseUnit !== 'Pcs') throw new TypeError('Tile base unit must be Pcs');
  const scale = {in: fraction(1n), cm: fraction(50n, 127n), mm: fraction(5n, 127n)};
  if (typeof config.dimensionUnit !== 'string' || !Object.hasOwn(scale, config.dimensionUnit))
    throw new TypeError('Unsupported tile dimension unit');
  const length = multiply(decimal(config.length, 'length', true), scale[config.dimensionUnit]);
  const width = multiply(decimal(config.width, 'width', true), scale[config.dimensionUnit]);
  const nominal = divide(multiply(length, width), fraction(144n));
  if (!['nominal', 'manufacturer'].includes(config.coveragePolicy))
    throw new TypeError('Invalid tile coverage policy');
  let advertised;
  if (Object.hasOwn(config, 'manufacturerSqftPerBox')) {
    advertised = decimal(config.manufacturerSqftPerBox, 'manufacturer coverage', true);
    identity(config.manufacturerEvidence, 'manufacturer evidence');
  } else if (Object.hasOwn(config, 'manufacturerEvidence')) {
    throw new TypeError('Manufacturer evidence requires manufacturer coverage');
  }
  if (config.coveragePolicy === 'manufacturer' && !advertised)
    throw new TypeError('Explicit verified manufacturer coverage required');
  return {
    pack, nominal,
    effective: config.coveragePolicy === 'manufacturer'
      ? divide(advertised, fraction(pack)) : nominal,
    snapshot: Object.freeze({...config})
  };
}

/** Pure quantity proposal, never a reservation or an authorized stock mutation. */
export function resolveTileQuantity(config, request) {
  const m = measurement(config);
  record(request, ['mode', 'boxes', 'extraPieces', 'requestedSqft', 'fulfillment']);
  let boxes, extra, pieces, requested = null;
  if (request.mode === 'pack') {
    if (Object.hasOwn(request, 'requestedSqft') || Object.hasOwn(request, 'fulfillment'))
      throw new TypeError('Ambiguous tile pack request');
    boxes = integer(request.boxes, 'boxes');
    extra = integer(request.extraPieces, 'extra pieces');
    pieces = boxes * m.pack + extra;
  } else if (request.mode === 'area') {
    if (Object.hasOwn(request, 'boxes') || Object.hasOwn(request, 'extraPieces') ||
        !['loose', 'box-only'].includes(request.fulfillment))
      throw new TypeError('Invalid tile area fulfillment');
    requested = decimal(request.requestedSqft, 'requested area', true);
    pieces = ceil(divide(requested, m.effective));
    if (request.fulfillment === 'box-only')
      pieces = ceil(fraction(pieces, m.pack)) * m.pack;
    boxes = pieces / m.pack;
    extra = pieces % m.pack;
  } else {
    throw new TypeError('Invalid tile quantity mode');
  }
  if (pieces <= 0n) throw new RangeError('Tile quantity must be positive');
  if (pieces > SAFE_INTEGER)
    throw new RangeError('Tile quantity exceeds safe integer compatibility');

  // The exact integer calculation bounds every Number supplied to the legacy
  // resolver; no fractional area conversion goes through binary floating point.
  const resolved = resolveProductUnitBreakdown_(
    {'Product ID': config.productId, Unit: 'Pcs'},
    [{conversionId: config.boxConversionId, qty: Number(boxes)},
      {conversionId: 'BASE', qty: Number(extra)}], Number(pieces),
    [{'Product ID': config.productId, 'Conversion ID': config.boxConversionId,
      'Unit Name': 'Box', 'Conversion Factor': Number(m.pack), Status: 'Active'}]
  );
  if (BigInt(resolved.baseQty) !== pieces)
    throw new Error('Tile physical unit compatibility mismatch');
  const actual = multiply(fraction(pieces), m.effective);
  return {
    pieces: String(pieces), boxes: String(pieces / m.pack),
    extraPieces: String(pieces % m.pack),
    nominalSqft: serialize(multiply(fraction(pieces), m.nominal)),
    actualSqft: serialize(actual), requestedSqft: requested && serialize(requested),
    displaySqft: display(actual), measurementSnapshot: m.snapshot,
    requestSnapshot: Object.freeze({...request}), unitSnapshot: resolved.snapshot
  };
}

/** Proposed exact selected-unit line calculation; no override selection or posting. */
export function priceTileQuantity(config, request, pricingUnit, unitPriceText) {
  if (!['Pcs', 'Box', 'Sqft'].includes(pricingUnit))
    throw new TypeError('Unsupported tile pricing unit');
  const price = decimal(unitPriceText, 'price');
  const quantity = resolveTileQuantity(config, request);
  const billingQuantity = pricingUnit === 'Pcs' ? fraction(BigInt(quantity.pieces))
    : pricingUnit === 'Box' ? fraction(BigInt(quantity.pieces), BigInt(config.piecesPerBox))
      : fraction(BigInt(quantity.actualSqft.numerator), BigInt(quantity.actualSqft.denominator));
  const exactAmount = multiply(billingQuantity, price);
  const amount = roundMinor(exactAmount);
  const shown = display(billingQuantity);
  const displayAmount = roundMinor(multiply(fraction(roundMinor(billingQuantity), 100n), price));
  return {
    quantity, billingQuantity: serialize(billingQuantity), billingQuantityDisplay: shown,
    exactAmount: serialize(exactAmount), lineAmountMinor: String(amount),
    displayQuantityAmountMinor: String(displayAmount),
    displayQuantityAmountDeltaMinor: String(amount - displayAmount),
    priceSnapshot: Object.freeze({pricingUnit, unitPriceText})
  };
}
