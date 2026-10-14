import { collection, doc, limit, onSnapshot, orderBy, query, type Unsubscribe } from 'firebase/firestore';
import { auth, db } from '../firebase';
import type { CashSale, CashSaleCreateInput } from '../models';

const requiredDb = () => {
  if (!db) throw new Error('Firebase yapılandırması bulunamadı.');
  return db;
};

const cashSalesRef = (ownerUid: string) => collection(requiredDb(), 'users', ownerUid, 'cashSales');

export function watchCashSales(ownerUid: string, next: (sales: CashSale[]) => void, fail: (error: Error) => void): Unsubscribe {
  return onSnapshot(query(cashSalesRef(ownerUid), orderBy('createdAt', 'desc'), limit(100)), (snapshot) => {
    next(snapshot.docs.map((item) => ({ id: item.id, ...item.data() } as CashSale)));
  }, fail);
}

export async function createCashSale(ownerUid: string, actorUid: string, input: CashSaleCreateInput): Promise<CashSale> {
  const currentUser = auth?.currentUser;
  if (!currentUser || currentUser.uid !== actorUid) {
    throw new Error('Peşin satış kaydetmek için geçerli kullanıcı oturumu gerekiyor.');
  }

  const saleId = input.saleId || doc(cashSalesRef(ownerUid)).id;
  const saleInput = { ...input };
  delete saleInput.saleId;
  let response: Response;
  let result: { sale?: CashSale; message?: unknown } = {};
  try {
    response = await fetch('/api/cash/sale', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${await currentUser.getIdToken()}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({ saleId, ...saleInput }),
    });
    result = await response.json() as { sale?: CashSale; message?: unknown };
  } catch {
    throw new Error('Peşin satış servisine ulaşılamadı. Bağlantıyı kontrol edip tekrar deneyin.');
  }
  if (!response.ok) {
    throw new Error(typeof result.message === 'string'
      ? result.message
      : 'Peşin satış kaydedilemedi. Stok değişmedi; listeyi yenileyip tekrar deneyin.');
  }
  if (!result.sale || result.sale.id !== saleId) throw new Error('Peşin satış kaydının yanıtı doğrulanamadı. Listeyi yenileyip kontrol edin.');
  return result.sale;
}
