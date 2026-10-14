import {
  collection, doc, limit, onSnapshot, orderBy, query,
  runTransaction, serverTimestamp, updateDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../firebase';
import { todayIso, type InventoryProduct, type StockMovement, type StockMovementType } from '../models';
import type { InventoryProductInput } from '../inventory-validation';

const requiredDb = () => {
  if (!db) throw new Error('Firebase yapılandırması bulunamadı.');
  return db;
};
const inventoryRef = (ownerUid: string) => collection(requiredDb(), 'users', ownerUid, 'inventory');
const stockActivityRef = (ownerUid: string) => collection(requiredDb(), 'users', ownerUid, 'stockActivity');

export function watchInventory(ownerUid: string, next: (products: InventoryProduct[]) => void, fail: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(inventoryRef(ownerUid), orderBy('updatedAt', 'desc')), (snapshot) => {
    next(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as InventoryProduct)));
  }, fail);
}

export function watchStockActivity(ownerUid: string, next: (rows: StockMovement[]) => void, fail: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(stockActivityRef(ownerUid), orderBy('date', 'desc'), limit(100)), (snapshot) => {
    next(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as StockMovement)));
  }, fail);
}

function productPayload(input: InventoryProductInput, actorUid: string) {
  return {
    name: input.name,
    sku: input.sku,
    unit: input.unit,
    salePriceCents: input.salePriceCents,
    lowStockThresholdMilli: input.lowStockThresholdMilli,
    createdBy: actorUid,
  };
}

export async function createInventoryProduct(ownerUid: string, actorUid: string, input: InventoryProductInput): Promise<void> {
  const database = requiredDb();
  const productDoc = doc(inventoryRef(ownerUid));
  const openingMovement = input.openingStockMilli > 0 ? doc(stockActivityRef(ownerUid)) : null;
  await runTransaction(database, async (transaction) => {
    const movementId = openingMovement?.id ?? '';
    transaction.set(productDoc, {
      ...productPayload(input, actorUid),
      stockQuantityMilli: input.openingStockMilli,
      active: true,
      lastStockMovementId: movementId,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    if (openingMovement) {
      const quantity = input.openingStockMilli;
      transaction.set(openingMovement, {
        type: 'opening',
        productId: productDoc.id,
        productDeltas: { [productDoc.id]: quantity },
        previousQuantities: { [productDoc.id]: 0 },
        nextQuantities: { [productDoc.id]: quantity },
        productNames: { [productDoc.id]: input.name },
        date: todayIso(),
        note: 'Açılış stoğu',
        createdBy: actorUid,
        createdAt: serverTimestamp(),
      });
    }
  });
}

export async function updateInventoryProduct(ownerUid: string, productId: string, input: InventoryProductInput): Promise<void> {
  await updateDoc(doc(requiredDb(), 'users', ownerUid, 'inventory', productId), {
    name: input.name,
    sku: input.sku,
    unit: input.unit,
    salePriceCents: input.salePriceCents,
    lowStockThresholdMilli: input.lowStockThresholdMilli,
    updatedAt: serverTimestamp(),
  });
}

export async function setInventoryProductActive(ownerUid: string, productId: string, active: boolean): Promise<void> {
  await updateDoc(doc(requiredDb(), 'users', ownerUid, 'inventory', productId), {
    active,
    updatedAt: serverTimestamp(),
  });
}

export async function adjustInventoryStock(
  ownerUid: string,
  actorUid: string,
  product: InventoryProduct,
  deltaMilli: number,
  type: Extract<StockMovementType, 'receipt' | 'adjustment'>,
  date: string,
  note: string,
): Promise<void> {
  if (!Number.isSafeInteger(deltaMilli) || deltaMilli === 0 || (type === 'receipt' && deltaMilli < 0)) {
    throw new Error('Stok değişikliği sıfırdan farklı ve türüne uygun olmalıdır.');
  }
  const database = requiredDb();
  const productDoc = doc(database, 'users', ownerUid, 'inventory', product.id);
  const movementDoc = doc(stockActivityRef(ownerUid));
  await runTransaction(database, async (transaction) => {
    const current = await transaction.get(productDoc);
    if (!current.exists()) throw new Error('Stok ürünü bulunamadı. Listeyi yenileyip tekrar deneyin.');
    const data = current.data();
    const previous = data.stockQuantityMilli;
    if (!Number.isSafeInteger(previous) || previous < 0) throw new Error('Ürünün stok miktarı geçersiz.');
    if (data.active !== true) throw new Error('Arşivlenmiş ürünün stoğunu değiştirmek için önce ürünü geri yükleyin.');
    const next = previous + deltaMilli;
    if (!Number.isSafeInteger(next) || next < 0 || next > 1_000_000_000) {
      throw new Error(next < 0 ? 'Stok miktarı sıfırın altına düşemez.' : 'Stok miktarı izin verilen üst sınırı aşıyor.');
    }
    transaction.update(productDoc, {
      stockQuantityMilli: next,
      lastStockMovementId: movementDoc.id,
      updatedAt: serverTimestamp(),
    });
    transaction.set(movementDoc, {
      type,
      productId: product.id,
      productDeltas: { [product.id]: deltaMilli },
      previousQuantities: { [product.id]: previous },
      nextQuantities: { [product.id]: next },
      productNames: { [product.id]: String(data.name ?? product.name) },
      date,
      note: note.trim(),
      createdBy: actorUid,
      createdAt: serverTimestamp(),
    });
  });
}
