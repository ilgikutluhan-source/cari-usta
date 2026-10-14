import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const source = readFileSync(new URL('../src/models.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const moduleValue = { exports: {} };
new Function('exports', 'require', compiled)(moduleValue.exports, createRequire(import.meta.url));
const { formatInputValueAndCaret, formatMoneyInput, parseMoneyInput, ungroupMoneyInput } = moduleValue.exports;

function typeWithAutoFormatting(keys) {
  let value = '';
  let caret = 0;
  for (const key of keys) {
    const raw = `${value.slice(0, caret)}${key}${value.slice(caret)}`;
    ({ value, caret } = formatInputValueAndCaret(raw, caret + key.length, formatMoneyInput));
  }
  return { value, amount: parseMoneyInput(value) };
}

for (const [keys, expectedValue, expectedAmount] of [
  ['100', '100', 100],
  ['500', '500', 500],
  ['999', '999', 999],
  ['1000', '1.000', 1_000],
  ['12345', '12.345', 12_345],
  ['123456', '123.456', 123_456],
  ['1234567', '1.234.567', 1_234_567],
  ['100000', '100.000', 100_000],
  ['140000', '140.000', 140_000],
  ['14000000', '14.000.000', 14_000_000],
  ['1250,50', '1.250,50', 1_250.5],
  ['500.25', '500,25', 500.25],
]) {
  const result = typeWithAutoFormatting(keys);
  assert.equal(result.value, expectedValue, `Turkish punctuation is updated while typing ${keys}`);
  assert.equal(result.amount, expectedAmount, `parsed amount for ${keys}`);
}

assert.equal(parseMoneyInput('1.2345'), 12_345, 'a continued auto-grouped integer remains an integer');
assert.equal(parseMoneyInput('1.250,50'), 1_250.5, 'Turkish grouped decimal parses exactly to kuruş');
assert.equal(parseMoneyInput('1.250,555'), null, 'more than two kuruş digits remain invalid');
assert.equal(ungroupMoneyInput('1.000'), '1000', 'focus removes the thousands separator before editing');
assert.equal(ungroupMoneyInput('140.000'), '140000', 'a large grouped amount returns to editable digits');
assert.equal(ungroupMoneyInput('1.250,50'), '1250,50', 'focus preserves the decimal comma and kuruş');
assert.deepEqual(
  formatInputValueAndCaret('140.000', 7, ungroupMoneyInput),
  { value: '140000', caret: 6 },
  'focus removes grouping and keeps the caret after the last digit',
);

let editable = '140000';
assert.equal(parseMoneyInput(editable), 140_000, 'an unformatted 140,000 TL payment parses correctly while editing');
const blurred = formatMoneyInput(editable);
assert.equal(blurred, '140.000', 'blur preserves Turkish thousands grouping without a decimal comma');
editable = ungroupMoneyInput(blurred) + '0';
assert.equal(editable, '1400000', 're-focusing allows more digits after a previously grouped amount');
assert.equal(parseMoneyInput(editable), 1_400_000, 'extended large amount remains an integer');
console.log('Money formatting regression checks passed (12 live-formatting cases + parser and focus/blur edge cases).');
