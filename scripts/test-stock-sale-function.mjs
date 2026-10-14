import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error('Bu test yalnızca Firestore Emulator altında çalıştırılmalıdır.');
}

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const outputDirectory = path.join(projectRoot, 'node_modules/.cache/cari-stock-sale-test');
rmSync(outputDirectory, { recursive: true, force: true });
try {
  const compile = spawnSync('pnpm', [
    'exec', 'tsc', '-p', 'tsconfig.functions.json', '--noEmit', 'false',
    '--outDir', outputDirectory, '--rootDir', '.',
  ], { cwd: projectRoot, stdio: 'inherit' });
  if (compile.status !== 0) throw new Error('Netlify Function test derlemesi başarısız.');

  const functionPath = path.join(outputDirectory, 'netlify/functions/stock-sale.mjs');
  const { applyStockSale, parseStockSaleInput, default: stockSaleHandler } = await import(pathToFileURL(functionPath).href);
  const cashSaleFunctionPath = path.join(outputDirectory, 'netlify/functions/cash-sale.mjs');
  const { applyCashSale, parseCashSaleInput, default: cashSaleHandler } = await import(pathToFileURL(cashSaleFunctionPath).href);
  const resetModulePath = path.join(outputDirectory, 'netlify/functions/reset-ledger.mjs');
  const { acquireResetLock, releaseResetLock, markResetIncomplete } = await import(pathToFileURL(resetModulePath).href);
  const { initializeApp, deleteApp } = await import('firebase-admin/app');
  const { getFirestore, Timestamp } = await import('firebase-admin/firestore');
  const projectId = process.env.GCLOUD_PROJECT || 'demo-cari-usta';
  const app = initializeApp({ projectId }, `stock-sale-test-${crypto.randomUUID()}`);
  const database = getFirestore(app);
  const ownerUid = 'function-owner';
  const staffUid = 'function-staff';
  const customerId = 'function-customer';
  const productId = 'function-product';
  const transactionId = 'function-sale-1';
  const customerPath = `users/${ownerUid}/customers/${customerId}`;
  const productPath = `users/${ownerUid}/inventory/${productId}`;

  try {
    await database.doc(`users/${ownerUid}/members/${staffUid}`).set({
      uid: staffUid,
      role: 'staff',
      active: true,
      createdBy: ownerUid,
      createdAt: new Date(),
    });
    await database.doc(`users/${ownerUid}/members/inactive-staff`).set({
      uid: 'inactive-staff',
      role: 'staff',
      active: false,
      createdBy: ownerUid,
      createdAt: new Date(),
    });
    await database.doc(customerPath).set({
      name: 'Emulator Cari',
      phone: '',
      company: '',
      note: '',
      currentDueDate: '',
      totalDebt: 0,
      totalPaid: 0,
      balance: 0,
      lastTransactionId: '',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    await database.doc(productPath).set({
      name: 'Emulator Seramik',
      sku: 'TEST-1',
      unit: 'adet',
      salePriceCents: 125_000,
      stockQuantityMilli: 5_000,
      lowStockThresholdMilli: 1_000,
      active: true,
      lastStockMovementId: 'opening-seed',
      createdBy: ownerUid,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const saleInput = parseStockSaleInput({
      customerId,
      transactionId,
      amountCents: 250_000,
      date: '2026-10-14',
      nextDueDate: '2026-10-28',
      note: 'Emulator atomik satış',
      items: [
        { name: 'Emulator Seramik', quantityMilli: 1_000, unit: 'adet', unitPriceCents: 125_000, lineTotalCents: 125_000, productId },
        { name: 'Emulator Seramik', quantityMilli: 1_000, unit: 'adet', unitPriceCents: 125_000, lineTotalCents: 125_000, productId },
      ],
    });
    await applyStockSale(database, ownerUid, staffUid, saleInput);

    const customer = (await database.doc(customerPath).get()).data();
    const product = (await database.doc(productPath).get()).data();
    const entry = (await database.doc(`${customerPath}/transactions/${transactionId}`).get()).data();
    const activity = (await database.doc(`users/${ownerUid}/activity/${transactionId}`).get()).data();
    const stockId = `${transactionId}_${productId}`;
    const stockMovement = (await database.doc(`users/${ownerUid}/stockActivity/${stockId}`).get()).data();
    assert.equal(customer.balance, 2_500);
    assert.equal(customer.totalDebt, 2_500);
    assert.equal(customer.totalPaid, 0);
    assert.equal(product.stockQuantityMilli, 3_000);
    assert.equal(product.lastStockMovementId, stockId);
    assert.equal(entry.amountCents, 250_000);
    assert.equal(entry.items.length, 2);
    assert.equal(entry.stockDeltas[productId], -2_000);
    assert.equal(activity.customerId, customerId);
    assert.equal(stockMovement.saleTransactionId, transactionId);
    assert.equal(stockMovement.productDeltas[productId], -2_000);

    const cashSaleId = 'function-cash-sale-1';
    const cashSaleInput = parseCashSaleInput({
      saleId: cashSaleId,
      amountCents: 125_000,
      date: '2026-10-14',
      note: 'Emulator peşin satış',
      paymentMethod: 'cash',
      customerId,
      items: [{ name: 'Emulator Seramik', quantityMilli: 1_000, unit: 'adet', unitPriceCents: 125_000, lineTotalCents: 125_000, productId }],
    });
    const savedCashSale = await applyCashSale(database, ownerUid, staffUid, cashSaleInput);
    const afterCashSaleProduct = (await database.doc(productPath).get()).data();
    const cashSale = (await database.doc(`users/${ownerUid}/cashSales/${cashSaleId}`).get()).data();
    const cashMovementId = `cash_${cashSaleId}_${productId}`;
    const cashMovement = (await database.doc(`users/${ownerUid}/stockActivity/${cashMovementId}`).get()).data();
    const customerAfterCashSale = (await database.doc(customerPath).get()).data();
    assert.equal(savedCashSale.id, cashSaleId);
    assert.equal(cashSale.invoiceNumber, `PS-20261014-${cashSaleId.slice(-8).toLocaleUpperCase('tr-TR')}`);
    assert.equal(cashSale.paymentMethod, 'cash');
    assert.equal(cashSale.customerName, 'Emulator Cari');
    assert.equal(cashSale.amountCents, 125_000);
    assert.equal(cashSale.vatRateBps, 2_000);
    assert.equal(cashSale.vatBaseCents + cashSale.vatCents, cashSale.amountCents);
    assert.equal(afterCashSaleProduct.stockQuantityMilli, 2_000);
    assert.equal(afterCashSaleProduct.lastStockMovementId, cashMovementId);
    assert.equal(cashMovement.cashSaleId, cashSaleId);
    assert.equal(cashMovement.productDeltas[productId], -1_000);
    assert.equal(customerAfterCashSale.balance, 2_500);
    assert.equal(customerAfterCashSale.totalDebt, 2_500);
    assert.equal(customerAfterCashSale.totalPaid, 0);
    assert.equal((await database.doc(`${customerPath}/transactions/${cashSaleId}`).get()).exists, false);
    assert.equal((await database.doc(`users/${ownerUid}/activity/${cashSaleId}`).get()).exists, false);

    const retriedCashSale = await applyCashSale(database, ownerUid, staffUid, cashSaleInput);
    assert.equal(retriedCashSale.id, cashSaleId);
    await assert.rejects(applyCashSale(database, ownerUid, staffUid, parseCashSaleInput({ ...cashSaleInput, note: 'Farklı payload' })), /farklı bir satış için kullanılmış/i);
    assert.equal((await database.doc(productPath).get()).data().stockQuantityMilli, 2_000);

    await database.doc(productPath).update({ salePriceCents: 130_000 });
    const stalePriceInput = parseCashSaleInput({ ...cashSaleInput, saleId: 'function-cash-sale-stale-price' });
    await assert.rejects(applyCashSale(database, ownerUid, staffUid, stalePriceInput), /fiyatı değişmiş/i);
    await database.doc(productPath).update({ salePriceCents: 125_000 });
    const cashOverStockInput = parseCashSaleInput({
      ...cashSaleInput,
      saleId: 'function-cash-sale-over-stock',
      amountCents: 375_000,
      items: [{ name: 'Emulator Seramik', quantityMilli: 3_000, unit: 'adet', unitPriceCents: 125_000, lineTotalCents: 375_000, productId }],
    });
    await assert.rejects(applyCashSale(database, ownerUid, staffUid, cashOverStockInput), /stok yetersiz/i);
    assert.equal((await database.doc(productPath).get()).data().stockQuantityMilli, 2_000);
    assert.equal((await database.doc(`users/${ownerUid}/cashSales/function-cash-sale-over-stock`).get()).exists, false);
    assert.equal((await database.doc(customerPath).get()).data().balance, 2_500);

    const beforeRejectedSale = afterCashSaleProduct.stockQuantityMilli;
    const overStockInput = parseStockSaleInput({
      customerId,
      transactionId: 'function-sale-over-stock',
      amountCents: 500_000,
      date: '2026-10-14',
      note: 'Yetersiz stok testi',
      items: [{ name: 'Emulator Seramik', quantityMilli: 4_000, unit: 'adet', unitPriceCents: 125_000, lineTotalCents: 500_000, productId }],
    });
    await assert.rejects(applyStockSale(database, ownerUid, staffUid, overStockInput), /stok yetersiz/i);
    assert.equal((await database.doc(productPath).get()).data().stockQuantityMilli, beforeRejectedSale);
    assert.equal((await database.doc(customerPath).get()).data().balance, 2_500);
    assert.equal((await database.doc(`${customerPath}/transactions/function-sale-over-stock`).get()).exists, false);

    await database.doc(`users/${ownerUid}/system/ledgerReset`).set({ status: 'running', startedAt: new Date() });
    const lockedInput = parseStockSaleInput({
      customerId,
      transactionId: 'function-sale-reset-locked',
      amountCents: 125_000,
      date: '2026-10-14',
      note: 'Reset kilidi testi',
      items: [{ name: 'Emulator Seramik', quantityMilli: 1_000, unit: 'adet', unitPriceCents: 125_000, lineTotalCents: 125_000, productId }],
    });
    await assert.rejects(applyStockSale(database, ownerUid, staffUid, lockedInput), /sıfırlanırken satış yapılamaz/i);
    const lockedCashSaleInput = parseCashSaleInput({
      ...cashSaleInput,
      saleId: 'function-cash-sale-reset-locked',
    });
    await assert.rejects(applyCashSale(database, ownerUid, staffUid, lockedCashSaleInput), /sıfırlanırken satış yapılamaz/i);
    assert.equal((await database.doc(productPath).get()).data().stockQuantityMilli, beforeRejectedSale);
    assert.equal((await database.doc(customerPath).get()).data().balance, 2_500);

    await database.doc(`users/${ownerUid}/system/ledgerReset`).delete();
    await assert.rejects(applyStockSale(database, ownerUid, staffUid, saleInput), /daha önce işlendi/i);

    await assert.rejects(applyStockSale(database, ownerUid, 'inactive-staff', parseStockSaleInput({
      ...saleInput,
      transactionId: 'function-sale-inactive-member',
    })), /aktif işletme üyeliği/i);
    await assert.rejects(applyCashSale(database, ownerUid, 'inactive-staff', parseCashSaleInput({
      ...cashSaleInput,
      saleId: 'function-cash-sale-inactive-member',
    })), /aktif işletme üyeliği/i);

    const handlerGet = await stockSaleHandler(new Request('https://example.test/api/stock/sale', { method: 'GET' }), {});
    const handlerOrigin = await stockSaleHandler(new Request('https://example.test/api/stock/sale', {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
      body: '{}',
    }), {});
    const handlerAuth = await stockSaleHandler(new Request('https://example.test/api/stock/sale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }), {});
    const handlerSize = await stockSaleHandler(new Request('https://example.test/api/stock/sale', {
      method: 'POST',
      headers: { Authorization: 'Bearer fake-token', 'Content-Type': 'application/json' },
      body: ' '.repeat(65_537),
    }), {});
    const cashHandlerGet = await cashSaleHandler(new Request('https://example.test/api/cash/sale', { method: 'GET' }), {});
    const cashHandlerOrigin = await cashSaleHandler(new Request('https://example.test/api/cash/sale', {
      method: 'POST',
      headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
      body: '{}',
    }), {});
    const cashHandlerAuth = await cashSaleHandler(new Request('https://example.test/api/cash/sale', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }), {});
    const cashHandlerSize = await cashSaleHandler(new Request('https://example.test/api/cash/sale', {
      method: 'POST',
      headers: { Authorization: 'Bearer fake-token', 'Content-Type': 'application/json' },
      body: ' '.repeat(65_537),
    }), {});
    assert.equal(handlerGet.status, 405);
    assert.equal(handlerOrigin.status, 403);
    assert.equal(handlerAuth.status, 401);
    assert.equal(handlerSize.status, 413);
    assert.equal(cashHandlerGet.status, 405);
    assert.equal(cashHandlerOrigin.status, 403);
    assert.equal(cashHandlerAuth.status, 401);
    assert.equal(cashHandlerSize.status, 413);

    const fencingLock = database.doc(`users/${ownerUid}/system/reset-lock-fencing-test`);
    await acquireResetLock(database, fencingLock, ownerUid, 'reset-operation-old');
    await assert.rejects(acquireResetLock(database, fencingLock, ownerUid, 'reset-operation-blocked'), /reset_in_progress/);
    await fencingLock.set({ leaseExpiresAt: Timestamp.fromMillis(Date.now() - 1_000) }, { merge: true });
    await acquireResetLock(database, fencingLock, ownerUid, 'reset-operation-new');
    await assert.rejects(releaseResetLock(database, fencingLock, 'reset-operation-old'), /reset_lock_lost/);
    await markResetIncomplete(database, fencingLock, 'reset-operation-old');
    const retainedLock = (await fencingLock.get()).data();
    assert.equal(retainedLock.operationId, 'reset-operation-new');
    assert.equal(retainedLock.status, 'running');
    await releaseResetLock(database, fencingLock, 'reset-operation-new');
    assert.equal((await fencingLock.get()).exists, false);

    console.log('PASS Function boundaries: inactive membership and HTTP method, origin, auth and body-size gates. PASS reset-lock fencing: expired takeover cannot be released or overwritten by the old operation.');
    console.log('PASS Admin stock sale: grouped product decrement, atomic ledger/activity, insufficient-stock rollback, reset lock and duplicate request rejection.');
    console.log('PASS Admin cash sale: unique invoice, VAT snapshot, atomic stock decrement/activity, no customer ledger mutation, idempotent same-payload retry, and rejection of changed-payload ID reuse, stale-price, overstock, reset-locked and inactive-member requests.');
  } finally {
    await deleteApp(app);
  }
} finally {
  rmSync(outputDirectory, { recursive: true, force: true });
}
