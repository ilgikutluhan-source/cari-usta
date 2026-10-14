import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const source = readFileSync(new URL('../src/inventory-validation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleValue = { exports: {} };
const localRequire = createRequire(import.meta.url);
new Function('exports', 'require', compiled)(moduleValue.exports, (id) => {
  if (id === './models') {
    const modelsSource = readFileSync(new URL('../src/models.ts', import.meta.url), 'utf8');
    const modelsCompiled = ts.transpileModule(modelsSource, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const modelsModule = { exports: {} };
    new Function('exports', 'require', modelsCompiled)(modelsModule.exports, localRequire);
    return modelsModule.exports;
  }
  return localRequire(id);
});
const { aggregateInventoryRequests, parseInventoryProductForm, parseNonNegativeQuantityMilli, validateInventorySale } = moduleValue.exports;

assert.equal(parseNonNegativeQuantityMilli('0'), 0);
assert.equal(parseNonNegativeQuantityMilli('1,275'), 1275);
assert.equal(parseNonNegativeQuantityMilli('1,2345'), null);
assert.equal(parseNonNegativeQuantityMilli('-1'), null);
const validProduct = parseInventoryProductForm({ name: 'Seramik', sku: ' S-01 ', unit: 'kutu', salePrice: '1.250,50', openingStock: '12,5', lowStockThreshold: '3' });
assert.equal(validProduct.ok, true);
if (validProduct.ok) {
  assert.deepEqual(validProduct.value, { name: 'Seramik', sku: 'S-01', unit: 'kutu', salePriceCents: 125050, openingStockMilli: 12500, lowStockThresholdMilli: 3000 });
}
assert.equal(parseInventoryProductForm({ name: '', sku: '', unit: 'adet', salePrice: '0', openingStock: '0', lowStockThreshold: '0' }).ok, false);
const products = [
  { id: 'p1', name: 'Harç', unit: 'çuval', stockQuantityMilli: 5000, active: true },
  { id: 'p2', name: 'Boya', unit: 'kova', stockQuantityMilli: 2_000, active: true },
];
const rows = [{ productId: 'p1', quantity: 2 }, { productId: 'p1', quantity: 3.001 }, { quantity: 9 }];
assert.deepEqual([...aggregateInventoryRequests(rows)], [['p1', 5001]]);
assert.match(validateInventorySale(rows, products), /Mevcut stok/);
assert.equal(validateInventorySale([{ productId: 'p1', quantity: 2 }, { quantity: 9 }], products), null);
assert.match(validateInventorySale([{ productId: 'missing', quantity: 1 }], products), /kullanılamıyor/);
assert.match(validateInventorySale([{ productId: 'p2', quantity: 3 }], products), /Mevcut stok/);
console.log('Inventory validation checks passed (quantity precision, product normalization, duplicate-line aggregation, active product and stock limits).');
