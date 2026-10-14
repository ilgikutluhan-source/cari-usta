import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  deleteDoc,
  doc,
  getDoc,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} from 'firebase/firestore';

const projectId = process.env.GCLOUD_PROJECT || 'demo-cari-usta';
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const ownerUid = 'rules-owner';
const staffUid = 'rules-staff';
const intruderUid = 'rules-outsider';
const productId = 'stock-product-1';
const customerId = 'stock-customer-1';
const day = '2026-10-14';
const env = await initializeTestEnvironment({ projectId, firestore: { rules } });

const ref = (firestore, path) => doc(firestore, path);
const productPath = `users/${ownerUid}/inventory/${productId}`;
const activityPath = `users/${ownerUid}/stockActivity`;
const customerPath = `users/${ownerUid}/customers/${customerId}`;
const cashSalePath = `users/${ownerUid}/cashSales/cash-sale-rules-test`;

try {
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(ref(db, `users/${ownerUid}/members/${ownerUid}`), {
      uid: ownerUid,
      email: 'owner@example.test',
      displayName: 'Rules Test Owner',
      role: 'owner',
      active: true,
      createdBy: ownerUid,
      createdAt: new Date(),
    });
    await setDoc(ref(db, `users/${ownerUid}/members/${staffUid}`), {
      uid: staffUid,
      email: 'staff@example.test',
      displayName: 'Rules Test Staff',
      role: 'staff',
      active: true,
      createdBy: ownerUid,
      createdAt: new Date(),
    });
    await setDoc(ref(db, `users/${ownerUid}/members/inactive-staff`), {
      uid: 'inactive-staff',
      email: 'inactive@example.test',
      displayName: 'Inactive Staff',
      role: 'staff',
      active: false,
      createdBy: ownerUid,
      createdAt: new Date(),
    });
    await setDoc(ref(db, customerPath), {
      name: 'Test Cari',
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
    await setDoc(ref(db, cashSalePath), {
      invoiceNumber: 'PS-20261014-RULESTEST', date: day, amountCents: 1_200,
      paymentMethod: 'cash', items: [], createdAt: new Date(),
    });
  });

  const staffDb = env.authenticatedContext(staffUid).firestore();
  const ownerDb = env.authenticatedContext(ownerUid).firestore();
  const outsiderDb = env.authenticatedContext(intruderUid).firestore();
  const inactiveDb = env.authenticatedContext('inactive-staff').firestore();
  const productRef = ref(staffDb, productPath);

  console.log('Checking opening stock...');
  const initialStock = 5_000;
  const openingId = 'opening-stock-1';
  await assertSucceeds(runTransaction(staffDb, async (transaction) => {
    transaction.set(productRef, {
      name: 'Örnek yapı ürünü',
      sku: 'TEST-001',
      unit: 'adet',
      salePriceCents: 1_200,
      stockQuantityMilli: initialStock,
      lowStockThresholdMilli: 1_000,
      active: true,
      lastStockMovementId: openingId,
      createdBy: staffUid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    transaction.set(ref(staffDb, `${activityPath}/${openingId}`), {
      type: 'opening',
      productId,
      productDeltas: { [productId]: initialStock },
      previousQuantities: { [productId]: 0 },
      nextQuantities: { [productId]: initialStock },
      productNames: { [productId]: 'Örnek yapı ürünü' },
      date: day,
      note: 'Açılış stoğu',
      createdBy: staffUid,
      createdAt: serverTimestamp(),
    });
  }));
  assert.equal((await getDoc(productRef)).data().stockQuantityMilli, initialStock);
  await assertSucceeds(getDoc(ref(ownerDb, productPath)));
  await assertSucceeds(getDoc(ref(ownerDb, `${activityPath}/${openingId}`)));
  await assertSucceeds(getDoc(ref(staffDb, `${activityPath}/${openingId}`)));
  await assertFails(getDoc(ref(outsiderDb, productPath)));
  await assertFails(getDoc(ref(inactiveDb, productPath)));
  await assertSucceeds(getDoc(ref(ownerDb, cashSalePath)));
  await assertSucceeds(getDoc(ref(staffDb, cashSalePath)));
  await assertFails(getDoc(ref(outsiderDb, cashSalePath)));
  await assertFails(getDoc(ref(inactiveDb, cashSalePath)));
  await assertFails(setDoc(ref(staffDb, `${cashSalePath}-client-write`), { invoiceNumber: 'CLIENT' }));
  await assertFails(updateDoc(ref(staffDb, cashSalePath), { amountCents: 0 }));
  await assertFails(deleteDoc(ref(staffDb, cashSalePath)));

  console.log('Opening stock passed. Checking receipt...');
  const receiptId = 'receipt-stock-1';
  const afterReceipt = 7_000;
  await assertSucceeds(runTransaction(staffDb, async (transaction) => {
    const product = await transaction.get(productRef);
    const previous = product.data().stockQuantityMilli;
    transaction.update(productRef, {
      stockQuantityMilli: afterReceipt,
      lastStockMovementId: receiptId,
      updatedAt: serverTimestamp(),
    });
    transaction.set(ref(staffDb, `${activityPath}/${receiptId}`), {
      type: 'receipt',
      productId,
      productDeltas: { [productId]: afterReceipt - previous },
      previousQuantities: { [productId]: previous },
      nextQuantities: { [productId]: afterReceipt },
      productNames: { [productId]: 'Örnek yapı ürünü' },
      date: day,
      note: 'Test stok girişi',
      createdBy: staffUid,
      createdAt: serverTimestamp(),
    });
  }));
  assert.equal((await getDoc(productRef)).data().stockQuantityMilli, afterReceipt);

  console.log('Receipt passed. Checking stock mutation bypass rejection...');
  await assertFails(updateDoc(productRef, {
    stockQuantityMilli: 99_000,
    lastStockMovementId: 'bypass-stock-rules',
    updatedAt: serverTimestamp(),
  }));

  console.log('Bypass rejection passed. Checking reset lock...');
  const resetLockPath = `users/${ownerUid}/system/ledgerReset`;
  await env.withSecurityRulesDisabled(async (context) => {
    await setDoc(ref(context.firestore(), resetLockPath), { startedAt: new Date() });
  });
  await assertFails(updateDoc(productRef, { name: 'Kilitte değişmemeli', updatedAt: serverTimestamp() }));
  const lockedLedgerId = 'locked-ledger-write';
  const lockedLedgerPayload = {
    type: 'debt', amount: 10, amountCents: 1_000, date: day, note: 'Reset kilidi defter testi',
    customerId, customerName: 'Test Cari', nextDueDate: '', createdAt: serverTimestamp(),
  };
  await assertFails(runTransaction(staffDb, async (transaction) => {
    transaction.update(ref(staffDb, customerPath), {
      totalDebt: 10, totalPaid: 0, balance: 10, lastTransactionId: lockedLedgerId, updatedAt: serverTimestamp(),
    });
    transaction.set(ref(staffDb, `${customerPath}/transactions/${lockedLedgerId}`), lockedLedgerPayload);
    transaction.set(ref(staffDb, `users/${ownerUid}/activity/${lockedLedgerId}`), lockedLedgerPayload);
  }));
  assert.equal((await getDoc(ref(staffDb, customerPath))).data().balance, 0);
  assert.equal((await getDoc(ref(staffDb, `${customerPath}/transactions/${lockedLedgerId}`))).exists(), false);
  const lockedReceiptId = 'locked-receipt-stock';
  await assertFails(runTransaction(staffDb, async (transaction) => {
    const product = await transaction.get(productRef);
    const previous = product.data().stockQuantityMilli;
    const next = previous + 1_000;
    transaction.update(productRef, {
      stockQuantityMilli: next,
      lastStockMovementId: lockedReceiptId,
      updatedAt: serverTimestamp(),
    });
    transaction.set(ref(staffDb, `${activityPath}/${lockedReceiptId}`), {
      type: 'receipt',
      productId,
      productDeltas: { [productId]: 1_000 },
      previousQuantities: { [productId]: previous },
      nextQuantities: { [productId]: next },
      productNames: { [productId]: 'Örnek yapı ürünü' },
      date: day,
      note: 'Reset kilidi testi',
      createdBy: staffUid,
      createdAt: serverTimestamp(),
    });
  }));
  await env.withSecurityRulesDisabled(async (context) => {
    await deleteDoc(ref(context.firestore(), resetLockPath));
  });
  assert.equal((await getDoc(productRef)).data().stockQuantityMilli, afterReceipt);

  const directSaleMovementId = 'client-sale-stock-only';
  await assertFails(runTransaction(staffDb, async (transaction) => {
    const product = await transaction.get(productRef);
    const previous = product.data().stockQuantityMilli;
    const next = previous - 1_000;
    transaction.update(productRef, {
      stockQuantityMilli: next,
      lastStockMovementId: directSaleMovementId,
      updatedAt: serverTimestamp(),
    });
    transaction.set(ref(staffDb, `${activityPath}/${directSaleMovementId}`), {
      type: 'sale',
      productId,
      productDeltas: { [productId]: -1_000 },
      previousQuantities: { [productId]: previous },
      nextQuantities: { [productId]: next },
      productNames: { [productId]: 'Örnek yapı ürünü' },
      date: day,
      note: 'Doğrudan istemci sale hareketi',
      customerId,
      customerName: 'Test Cari',
      saleTransactionId: 'not-validated-sale',
      createdBy: staffUid,
      createdAt: serverTimestamp(),
    });
  }));
  assert.equal((await getDoc(productRef)).data().stockQuantityMilli, afterReceipt);
  assert.equal((await getDoc(ref(staffDb, `${activityPath}/${directSaleMovementId}`))).exists(), false);

  console.log('Reset lock passed. Checking direct client sale rejection...');
  const saleId = 'linked-sale-1';
  const saleAmountCents = 2_400;
  const soldQuantityMilli = 2_000;
  const salePayload = {
    type: 'debt',
    amount: saleAmountCents / 100,
    amountCents: saleAmountCents,
    date: day,
    note: 'Rules test sale',
    customerId,
    customerName: 'Test Cari',
    nextDueDate: '2026-10-21',
    items: [{ name: 'Örnek yapı ürünü', quantityMilli: soldQuantityMilli, unit: 'adet', unitPriceCents: 1_200, lineTotalCents: saleAmountCents, productId }],
    vatRateBps: 2_000,
    vatBaseCents: 2_000,
    vatCents: 400,
    stockDeltas: { [productId]: -soldQuantityMilli },
    createdAt: serverTimestamp(),
  };
  const nextStock = afterReceipt - soldQuantityMilli;
  await assertFails(runTransaction(staffDb, async (transaction) => {
    transaction.update(ref(staffDb, customerPath), {
      totalDebt: saleAmountCents / 100,
      totalPaid: 0,
      balance: saleAmountCents / 100,
      currentDueDate: '2026-10-21',
      lastTransactionId: saleId,
      updatedAt: serverTimestamp(),
    });
    transaction.set(ref(staffDb, `${customerPath}/transactions/${saleId}`), salePayload);
    transaction.set(ref(staffDb, `users/${ownerUid}/activity/${saleId}`), salePayload);
  }));

  const saleStockIdFull = `${saleId}-full_${productId}`;
  const fullSaleId = `${saleId}-full`;
  const fullSalePayload = { ...salePayload, stockDeltas: { [productId]: -soldQuantityMilli, 'unlinked-product': -1 } };
  await assertFails(runTransaction(staffDb, async (transaction) => {
    const currentProduct = await transaction.get(productRef);
    const currentCustomer = await transaction.get(ref(staffDb, customerPath));
    assert.equal(currentProduct.data().stockQuantityMilli, afterReceipt);
    assert.equal(currentCustomer.data().balance, 0);

    transaction.update(ref(staffDb, customerPath), {
      totalDebt: saleAmountCents / 100,
      totalPaid: 0,
      balance: saleAmountCents / 100,
      currentDueDate: '2026-10-21',
      lastTransactionId: fullSaleId,
      updatedAt: serverTimestamp(),
    });
    transaction.update(productRef, {
      stockQuantityMilli: nextStock,
      lastStockMovementId: saleStockIdFull,
      updatedAt: serverTimestamp(),
    });
    transaction.set(ref(staffDb, `${customerPath}/transactions/${fullSaleId}`), fullSalePayload);
    transaction.set(ref(staffDb, `users/${ownerUid}/activity/${fullSaleId}`), fullSalePayload);
    transaction.set(ref(staffDb, `${activityPath}/${saleStockIdFull}`), {
      type: 'sale',
      productId,
      productDeltas: { [productId]: -soldQuantityMilli },
      previousQuantities: { [productId]: afterReceipt },
      nextQuantities: { [productId]: nextStock },
      productNames: { [productId]: 'Örnek yapı ürünü' },
      date: day,
      note: 'Rules test sale',
      customerId,
      customerName: 'Test Cari',
      saleTransactionId: fullSaleId,
      createdBy: staffUid,
      createdAt: serverTimestamp(),
    });
  }));

  assert.equal((await getDoc(productRef)).data().stockQuantityMilli, afterReceipt);
  assert.equal((await getDoc(ref(staffDb, customerPath))).data().balance, 0);
  assert.equal((await getDoc(ref(staffDb, `${customerPath}/transactions/${saleId}`))).exists(), false);
  assert.equal((await getDoc(ref(staffDb, `${activityPath}/${saleStockIdFull}`))).exists(), false);
  console.log('PASS Firestore Rules: owner/staff access, inactive/outsider rejection, atomic stock receipt, reset lock on ledger and inventory writes, direct client sale rejection, and cashSales member-read/client-write denial.');
} finally {
  await env.cleanup();
}
