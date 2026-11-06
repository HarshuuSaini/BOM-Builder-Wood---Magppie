const assert = require('node:assert/strict');
require('./test-purchase-rounding.cjs');
const { conversionMarginTotals } = require('../src/lib/conversion-margin.ts');
const { normalizeMarginPricing } = require('../src/lib/normalize-margin-pricing.ts');
const { comparisonProjectPricing } = require('../src/lib/comparison-project-pricing.ts');
const { missingPriceReasons } = require('../src/lib/price-change-audit.ts');
const near = (a, b) => assert(Math.abs(a - b) < 0.00001, `${a} != ${b}`);
const result = conversionMarginTotals(100000, 40, false);
near(result.subtotal, 166666.6666666667);
near(result.conversion / result.subtotal, 0.4);
near(conversionMarginTotals(100000, 40, true).total, 196666.6666666667);
assert.equal(conversionMarginTotals(100000, 0, false).total, 100000);
assert.equal(conversionMarginTotals(0, 40, false).total, 0);
for (const rate of [-1, 100, 101, Infinity, NaN, '40']) assert.throws(() => conversionMarginTotals(100000, rate, false), /below 100/);
const legacy = { id: 'legacy', name: 'Legacy quote', rows: [{ 'Record Type': 'settings', Data: JSON.stringify({ pricing: {
  conversionPct: 40, profitPct: 10, includeTax: false, transportation: { mode: 'direct', value: 0 }, installation: { mode: 'direct', value: 0 }, loading: { mode: 'direct', value: 0 },
  _serviceRateApproval: { rates: { conversionPct: 40, profitPct: 10 }, reason: 'Old rates' },
} }) }], costing: { areaSqft: 100, materialCost: 100000, transportation: 0, installation: 0, loading: 0, conversion: 40000, profit: 14000, tax: 0, total: 154000, items: [], unpriced: [] },
priceChanges: [{ key: 'settings.settings.pricing.profitPct', reason: '', defaultPrice: 0, changedPrice: 10, label: 'Profit', unit: '%' }] };
const before = JSON.stringify(legacy);
const normalized = normalizeMarginPricing(legacy);
near(normalized.costing.total, 166666.6666666667);
assert(!JSON.stringify(normalized).includes('profit'));
assert.equal(JSON.stringify(legacy), before, 'Reading a legacy quote does not rewrite original revision data');
assert.deepEqual(normalizeMarginPricing(normalized), normalized, 'Margin normalization is idempotent');
const comparison = comparisonProjectPricing(normalized);
near(comparison.total, normalized.costing.total);
assert.equal(comparison.rates.conversionPct, 40);
assert(!('profit' in comparison));
assert.equal(missingPriceReasons(legacy.priceChanges).length, 0, 'Retired percentage audits cannot block saving');
const invalid = structuredClone(legacy); invalid.rows[0].Data = JSON.stringify({ pricing: { conversionPct: 100 } });
assert.throws(() => normalizeMarginPricing(invalid), /below 100/);
console.log('PASS: 40% actual margin, GST after conversion, boundary validation, legacy setting removal, saved quote normalization and comparison consistency.');
