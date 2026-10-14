import {
  collection, doc, limit, onSnapshot, orderBy, query,
  runTransaction, serverTimestamp, setDoc, updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import { money, splitVatInclusiveCents, type Customer, type LedgerEntry, type SaleItemInput } from '../models';
import { normalizeSaleItems } from '../sales-validation';
import { aggregateInventoryRequests } from '../inventory-validation';

const requiredDb = () => {
  if (!db) throw new Error('Firebase yapılandırması bulunamadı.');
  return db;
};

const customersRef = (uid: string) => collection(requiredDb(), 'users', uid, 'customers');
const activityRef = (uid: string) => collection(requiredDb(), 'users', uid, 'activity');
const stockActivityRef = (uid: string) => collection(requiredDb(), 'users', uid, 'stockActivity');
const maxLedgerCents = 1_000_000_000_000;
function storedCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -1e-7) return null;
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || cents < 0 || cents > maxLedgerCents
    || Math.abs(value - cents / 100) >= 1e-7) return null;
  return cents;
}

export function watchCustomers(uid: string, next: (rows: Customer[]) => void, fail: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(customersRef(uid), orderBy('updatedAt', 'desc')), (snapshot) => {
    next(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as Customer)));
  }, fail);
}

export function watchActivity(uid: string, next: (rows: LedgerEntry[]) => void, fail: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(activityRef(uid), orderBy('date', 'desc'), limit(50)), (snapshot) => {
    next(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as LedgerEntry)));
  }, fail);
}

export function watchCustomerEntries(uid: string, customerId: string, next: (rows: LedgerEntry[]) => void, fail: (error: Error) => void): Unsubscribe {
  const ref = collection(requiredDb(), 'users', uid, 'customers', customerId, 'transactions');
  return onSnapshot(query(ref, orderBy('date', 'desc')), (snapshot) => {
    next(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as LedgerEntry)));
  }, fail);
}

export async function createCustomer(uid: string, data: Pick<Customer, 'name' | 'phone' | 'company' | 'note'>): Promise<void> {
  const ref = doc(customersRef(uid));
  await setDoc(ref, {
    ...data,
    currentDueDate: '',
    totalDebt: 0,
    totalPaid: 0,
    balance: 0,
    lastTransactionId: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
}

export async function updateCustomerProfile(uid: string, customerId: string, profile: Pick<Customer, 'name' | 'phone'>): Promise<void> {
  const name = profile.name.trim();
  const phone = profile.phone.trim();
  if (!name || name.length > 120 || phone.length > 24) {
    throw new Error('Müşteri adı zorunludur; ad en fazla 120, telefon en fazla 24 karakter olabilir.');
  }
  await updateDoc(doc(requiredDb(), 'users', uid, 'customers', customerId), {
    name,
    phone,
    updatedAt: serverTimestamp(),
  });
}

export async function createMovement(uid: string, actorUid: string, customer: Customer, entry: Omit<LedgerEntry, 'id' | 'customerId' | 'customerName' | 'items'> & { items?: SaleItemInput[] }): Promise<void> {
  const database = requiredDb();
  if (entry.type !== 'debt' && entry.type !== 'payment') throw new Error('Bu hareket türü bu işlemde kullanılamaz.');
  if (!Number.isFinite(entry.amount) || entry.amount <= 0) throw new Error('Tutar sıfırdan büyük olmalıdır.');
  const amountCents = Math.round(entry.amount * 100);
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > maxLedgerCents || Math.abs(entry.amount - amountCents / 100) > 1e-8) {
    throw new Error('Tutar en fazla iki kuruş hanesiyle girilmelidir.');
  }
  if (entry.items !== undefined && entry.type !== 'debt') throw new Error('Ürün satırları yalnızca satış hareketine eklenebilir.');
  if (entry.type === 'payment' && (entry.vatRateBps !== undefined || entry.vatBaseCents !== undefined || entry.vatCents !== undefined)) {
    throw new Error('Tahsilat hareketine KDV alanı eklenemez.');
  }
  const items = entry.items === undefined ? undefined : normalizeSaleItems(entry.items, amountCents);
  const stockRequests = items ? aggregateInventoryRequests(items) : new Map<string, number>();
  if (stockRequests.size > 25) throw new Error('Bir satışta en fazla 25 stok ürünü seçilebilir.');
  const vat = entry.type === 'debt' ? splitVatInclusiveCents(amountCents) : null;
  if (entry.type === 'debt' && !vat) throw new Error('Satış tutarı için KDV ayrıştırılamadı.');
  const amount = amountCents / 100;

  if (items?.length) {
    const currentUser = auth?.currentUser;
    if (!currentUser || currentUser.uid !== actorUid) {
      throw new Error('Ürünlü satış için geçerli kullanıcı oturumu gerekiyor.');
    }
    const transactionReference = doc(collection(database, 'users', uid, 'customers', customer.id, 'transactions'));
    let response: Response;
    let result: { message?: unknown } = {};
    try {
      response = await fetch('/api/stock/sale', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${await currentUser.getIdToken()}`,
          'Content-Type': 'application/json',
        },
        cache: 'no-store',
        body: JSON.stringify({
          customerId: customer.id,
          transactionId: transactionReference.id,
          amountCents,
          date: entry.date,
          note: entry.note,
          nextDueDate: entry.type === 'debt' ? entry.nextDueDate ?? '' : '',
          items,
        }),
      });
      result = await response.json() as { message?: unknown };
    } catch {
      throw new Error('Ürünlü satış servisine ulaşılamadı. Bağlantıyı kontrol edip tekrar deneyin.');
    }
    if (!response.ok) {
      throw new Error(typeof result.message === 'string'
        ? result.message
        : 'Ürünlü satış kaydedilemedi. Stok ve cari değişmedi; listeyi yenileyip tekrar deneyin.');
    }
    return;
  }

  const customerDoc = doc(database, 'users', uid, 'customers', customer.id);
  const txDoc = doc(collection(customerDoc, 'transactions'));
  const activityDoc = doc(activityRef(uid), txDoc.id);
  const stockActivityDocs = new Map([...stockRequests.keys()].map((productId) => [
    productId,
    doc(stockActivityRef(uid), `${txDoc.id}_${productId}`),
  ]));

  await runTransaction(database, async (transaction) => {
    const current = await transaction.get(customerDoc);
    if (!current.exists()) throw new Error('Cari hesap bulunamadı; sayfayı yenileyip tekrar deneyin.');
    const currentData = current.data();
    const totalDebtCents = storedCents(currentData.totalDebt);
    const totalPaidCents = storedCents(currentData.totalPaid);
    const balanceCents = storedCents(currentData.balance);
    if (totalDebtCents === null || totalPaidCents === null || balanceCents === null
      || totalDebtCents - totalPaidCents !== balanceCents) {
      throw new Error('Cari tutarları kuruş hassasiyetinde tutarlı değil. Kaydetmeden önce hesap özeti incelenmeli.');
    }
    if (entry.type === 'payment' && amountCents > balanceCents) {
      throw new Error(`Tahsilat tutarı güncel kalan bakiyeyi (${money(balanceCents / 100)}) aşamaz.`);
    }
    const stockState = new Map<string, { ref: ReturnType<typeof doc>; name: string; quantity: number; nextQuantity: number }>();
    for (const [productId, requestedMilli] of stockRequests) {
      const productDoc = doc(database, 'users', uid, 'inventory', productId);
      const productSnapshot = await transaction.get(productDoc);
      if (!productSnapshot.exists()) throw new Error('Satışta seçilen stok ürünü bulunamadı. Ürünü yenileyip tekrar seçin.');
      const product = productSnapshot.data();
      const name = typeof product.name === 'string' ? product.name : '';
      const unit = typeof product.unit === 'string' ? product.unit : '';
      const stock = product.stockQuantityMilli;
      const price = product.salePriceCents;
      if (product.active !== true || !name || !unit || !Number.isSafeInteger(stock) || stock < 0
        || !Number.isSafeInteger(price) || price <= 0) {
        throw new Error('Satışta seçilen stok ürünü artık kullanılamıyor. Ürün kaydını kontrol edin.');
      }
      const catalogLines = items?.filter((item) => item.productId === productId) ?? [];
      if (catalogLines.some((item) => item.name !== name || item.unit !== unit || item.unitPriceCents !== price)) {
        throw new Error(`${name} ürününün fiyat veya bilgisi satış ekranı açıldıktan sonra değişmiş. Satış satırını yeniden seçin.`);
      }
      if (requestedMilli > stock) {
        throw new Error(`${name} için stok yetersiz. Güncel stok: ${(stock / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 3 })} ${unit}.`);
      }
      stockState.set(productId, { ref: productDoc, name, quantity: stock, nextQuantity: stock - requestedMilli });
    }
    const nextDebtCents = totalDebtCents + (entry.type === 'debt' ? amountCents : 0);
    const nextPaidCents = totalPaidCents + (entry.type === 'payment' ? amountCents : 0);
    const nextBalanceCents = balanceCents + (entry.type === 'debt' ? amountCents : -amountCents);
    if ([nextDebtCents, nextPaidCents, nextBalanceCents].some((value) => !Number.isSafeInteger(value) || value > maxLedgerCents)) {
      throw new Error('İşlem tutarı cari hesap için izin verilen üst sınırı aşıyor.');
    }
    const payload = {
      ...entry,
      ...(items ? { items } : {}),
      ...(stockRequests.size ? { stockDeltas: Object.fromEntries([...stockRequests].map(([id, quantity]) => [id, -quantity])) } : {}),
      ...(vat ? { vatRateBps: vat.vatRateBps, vatBaseCents: vat.vatBaseCents, vatCents: vat.vatCents } : {}),
      amount,
      amountCents,
      customerId: customer.id,
      customerName: String(currentData.name ?? customer.name),
      createdAt: serverTimestamp(),
    };
    transaction.update(customerDoc, {
      totalDebt: nextDebtCents / 100,
      totalPaid: nextPaidCents / 100,
      balance: nextBalanceCents / 100,
      lastTransactionId: txDoc.id,
      ...(entry.type === 'debt' && entry.nextDueDate ? { currentDueDate: entry.nextDueDate } : {}),
      ...(entry.type === 'payment' && nextBalanceCents === 0 ? { currentDueDate: '' } : {}),
      updatedAt: serverTimestamp(),
    });
    for (const [productId, requestedMilli] of stockRequests) {
      const product = stockState.get(productId);
      const movementDoc = stockActivityDocs.get(productId);
      if (!product || !movementDoc) throw new Error('Stok ürünü doğrulanamadı. Satış kaydedilmedi.');
      transaction.update(product.ref, {
        stockQuantityMilli: product.nextQuantity,
        lastStockMovementId: movementDoc.id,
        updatedAt: serverTimestamp(),
      });
      transaction.set(movementDoc, {
        type: 'sale',
        productId,
        productDeltas: { [productId]: -requestedMilli },
        previousQuantities: { [productId]: product.quantity },
        nextQuantities: { [productId]: product.nextQuantity },
        productNames: { [productId]: product.name },
        date: entry.date,
        note: entry.note,
        customerId: customer.id,
        customerName: String(currentData.name ?? customer.name),
        saleTransactionId: txDoc.id,
        createdBy: actorUid,
        createdAt: serverTimestamp(),
      });
    }
    transaction.set(txDoc, payload);
    transaction.set(activityDoc, payload);
  });
}

export async function updateDueDate(uid: string, customer: Customer, nextDueDate: string, date: string): Promise<void> {
  const database = requiredDb();
  const customerDoc = doc(database, 'users', uid, 'customers', customer.id);
  const txDoc = doc(collection(customerDoc, 'transactions'));
  const activityDoc = doc(activityRef(uid), txDoc.id);
  await runTransaction(database, async (transaction) => {
    const current = await transaction.get(customerDoc);
    if (!current.exists()) throw new Error('Cari hesap bulunamadı; sayfayı yenileyip tekrar deneyin.');
    const currentData = current.data();
    const payload = {
      type: 'due_update' as const,
      amount: 0,
      amountCents: 0,
      date,
      note: 'Ödeme vadesi güncellendi',
      customerId: customer.id,
      customerName: String(currentData.name ?? customer.name),
      previousDueDate: String(currentData.currentDueDate ?? ''),
      nextDueDate,
      createdAt: serverTimestamp(),
    };
    transaction.update(customerDoc, {
      currentDueDate: nextDueDate,
      lastTransactionId: txDoc.id,
      updatedAt: serverTimestamp(),
    });
    transaction.set(txDoc, payload);
    transaction.set(activityDoc, payload);
  });
}

export async function archiveCustomer(uid: string, customerId: string, archived: boolean): Promise<void> {
  const customerDoc = doc(requiredDb(), 'users', uid, 'customers', customerId);
  await updateDoc(customerDoc, {
    archivedAt: archived ? new Date().toISOString() : '',
    updatedAt: serverTimestamp(),
  });
}
