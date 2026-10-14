import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const localRequire = createRequire(import.meta.url);
const modelsSource = readFileSync(new URL('../src/models.ts', import.meta.url), 'utf8');
const modelsCompiled = ts.transpileModule(modelsSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const modelsModule = { exports: {} };
new Function('exports', 'require', modelsCompiled)(modelsModule.exports, localRequire);

const source = readFileSync(new URL('../src/cash-sales-validation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleValue = { exports: {} };
new Function('exports', 'require', compiled)(moduleValue.exports, (id) => {
  if (id === './models') return modelsModule.exports;
  return localRequire(id);
});

const { buildCashSaleLines } = moduleValue.exports;
const product = {
  id: 'product-1', name: 'Seramik yapıştırıcısı', sku: 'YAPI-001', unit: 'adet',
  salePriceCents: 125_000, stockQuantityMilli: 4_000, lowStockThresholdMilli: 1_000,
  active: true, lastStockMovementId: '', createdBy: 'test',
};
const failure = (rows, products = [product]) => {
  const result = buildCashSaleLines(rows, products);
  assert.equal(result.ok, false);
  return result.ok ? '' : result.error;
};

const valid = buildCashSaleLines([
  { id: 'row-1', productId: product.id, quantity: '2' },
  { id: 'row-2', productId: product.id, quantity: '1,5' },
], [product]);
assert.equal(valid.ok, true);
if (valid.ok) {
  assert.equal(valid.amountCents, 437_500);
  assert.equal(valid.items.length, 2);
  assert.equal(valid.items[0].productId, product.id);
  assert.equal(valid.items[1].quantityMilli, 1_500);
}

assert.match(failure([
  { id: 'row-1', productId: product.id, quantity: '2' },
  { id: 'row-2', productId: product.id, quantity: '2,001' },
]), /stok yetersiz/i);
assert.match(failure([{ id: 'bad-quantity', productId: product.id, quantity: '1,2345' }]), /miktar/i);
assert.match(failure([{ id: 'missing-product', productId: 'missing', quantity: '1' }]), /kullanılamıyor/i);
assert.match(failure([{ id: 'empty-stock', productId: product.id, quantity: '1' }], [{ ...product, stockQuantityMilli: 0 }]), /stok yetersiz/i);
assert.match(failure([{ id: 'inactive', productId: product.id, quantity: '1' }], [{ ...product, active: false }]), /kullanılamıyor/i);
assert.match(failure([]), /en az bir ürün/i);
assert.match(failure(Array.from({ length: 26 }, (_, index) => ({ id: `row-${index}`, productId: product.id, quantity: '0,001' }))), /en fazla 25/i);

console.log('Cash sale validation checks passed (catalog product, integer-kuruş totals, Turkish quantity precision, aggregate stock limit, 25-line cap, inactive/out-of-stock and empty-cart rejection).');
