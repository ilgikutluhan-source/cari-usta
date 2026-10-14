import type { Config, Context } from '@netlify/functions';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { splitVatInclusiveCents, type StoredSaleItem } from '../../src/models.js';
import { getFirebaseAdminServices, readFirebaseAdminSecrets } from '../lib/firebase-admin.js';

const maxBodyBytes = 64 * 1024;
const maxLedgerCents = 1_000_000_000_000;
const maxQuantityMilli = 1_000_000_000;
const allowedInputKeys = ['customerId', 'transactionId', 'amountCents', 'date', 'note', 'nextDueDate', 'items'];
const allowedItemKeys = ['name', 'quantityMilli', 'unit', 'unitPriceCents', 'lineTotalCents', 'productId'];

type StockSaleItemInput = Omit<StoredSaleItem, 'productId'> & { productId?: string };
type StockSaleInput = {
  customerId: string;
  transactionId: string;
  amountCents: number;
  date: string;
  note: string;
  nextDueDate: string;
  items: StockSaleItemInput[];
};
type ProductState = {
  reference: FirebaseFirestore.DocumentReference;
  movementReference: FirebaseFirestore.DocumentReference;
  name: string;
  unit: string;
  priceCents: number;
  previousMilli: number;
  nextMilli: number;
  requestedMilli: number;
};

class StockSaleError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = 'StockSaleError';
  }
}

function response(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return new URL(origin).origin === new URL(request.url).origin;
  } catch {
    return false;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIsoDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function safeDocumentId(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value);
}

function expectedLineTotalCents(unitPriceCents: number, quantityMilli: number): number | null {
  const total = (BigInt(unitPriceCents) * BigInt(quantityMilli) + 500n) / 1000n;
  if (total < 0n || total > BigInt(maxLedgerCents)) return null;
  return Number(total);
}

export function parseStockSaleInput(value: unknown): StockSaleInput {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowedInputKeys.includes(key))) {
    throw new StockSaleError('invalid_request', 400, 'Satış isteği geçersiz. Formu yenileyip tekrar deneyin.');
  }
  if (!safeDocumentId(value.customerId) || !safeDocumentId(value.transactionId)) {
    throw new StockSaleError('invalid_request', 400, 'Cari veya satış kimliği geçersiz.');
  }
  if (!Number.isSafeInteger(value.amountCents) || (value.amountCents as number) <= 0 || (value.amountCents as number) > maxLedgerCents) {
    throw new StockSaleError('invalid_request', 400, 'Satış tutarı kuruş hassasiyetinde ve izin verilen sınırlar içinde olmalıdır.');
  }
  if (!isIsoDate(value.date)) {
    throw new StockSaleError('invalid_request', 400, 'İşlem tarihi geçersiz.');
  }
  const nextDueDate = value.nextDueDate === undefined ? '' : value.nextDueDate;
  if (typeof nextDueDate !== 'string' || (nextDueDate !== '' && !isIsoDate(nextDueDate))) {
    throw new StockSaleError('invalid_request', 400, 'Ödeme vadesi geçersiz.');
  }
  if (typeof value.note !== 'string' || value.note.trim().length > 180) {
    throw new StockSaleError('invalid_request', 400, 'Açıklama en fazla 180 karakter olabilir.');
  }
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 25) {
    throw new StockSaleError('invalid_request', 400, 'Satış 1–25 ürün satırıyla sınırlıdır.');
  }

  const items = value.items.map((rawItem): StockSaleItemInput => {
    if (!isRecord(rawItem) || Object.keys(rawItem).some((key) => !allowedItemKeys.includes(key))) {
      throw new StockSaleError('invalid_request', 400, 'Satış ürün satırı geçersiz.');
    }
    const name = typeof rawItem.name === 'string' ? rawItem.name.trim() : '';
    const unit = typeof rawItem.unit === 'string' ? rawItem.unit.trim() : '';
    const quantityMilli = rawItem.quantityMilli;
    const unitPriceCents = rawItem.unitPriceCents;
    const lineTotalCents = rawItem.lineTotalCents;
    const productId = rawItem.productId;
    if (!name || name.length > 120 || !unit || unit.length > 24
      || !Number.isSafeInteger(quantityMilli) || (quantityMilli as number) <= 0 || (quantityMilli as number) > maxQuantityMilli
      || !Number.isSafeInteger(unitPriceCents) || (unitPriceCents as number) < 0 || (unitPriceCents as number) > maxLedgerCents
      || !Number.isSafeInteger(lineTotalCents) || (lineTotalCents as number) < 0 || (lineTotalCents as number) > maxLedgerCents
      || (productId !== undefined && !safeDocumentId(productId))) {
      throw new StockSaleError('invalid_request', 400, 'Ürün adı, birimi, miktarı veya fiyatı geçersiz.');
    }
    const expected = expectedLineTotalCents(unitPriceCents as number, quantityMilli as number);
    if (expected === null || expected !== lineTotalCents) {
      throw new StockSaleError('invalid_request', 400, 'Ürün satır toplamı miktar ve birim fiyatıyla eşleşmiyor.');
    }
    return {
      name,
      unit,
      quantityMilli: quantityMilli as number,
      unitPriceCents: unitPriceCents as number,
      lineTotalCents: lineTotalCents as number,
      ...(typeof productId === 'string' ? { productId } : {}),
    };
  });

  const amountCents = value.amountCents as number;
  const itemTotalCents = items.reduce((total, item) => total + item.lineTotalCents, 0);
  if (!Number.isSafeInteger(itemTotalCents) || itemTotalCents !== amountCents) {
    throw new StockSaleError('invalid_request', 400, 'Satış toplamı ürün satırlarının toplamıyla eşleşmiyor.');
  }

  return {
    customerId: value.customerId,
    transactionId: value.transactionId,
    amountCents,
    date: value.date,
    note: value.note.trim(),
    nextDueDate,
    items,
  };
}

function storedCents(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || cents > maxLedgerCents || Math.abs(value - cents / 100) >= 1e-7) return null;
  return cents;
}

export async function applyStockSale(
  database: Firestore,
  ownerUid: string,
  actorUid: string,
  input: StockSaleInput,
): Promise<void> {
  const customerReference = database.doc(`users/${ownerUid}/customers/${input.customerId}`);
  const memberReference = database.doc(`users/${ownerUid}/members/${actorUid}`);
  const resetLockReference = database.doc(`users/${ownerUid}/system/ledgerReset`);
  const transactionReference = customerReference.collection('transactions').doc(input.transactionId);
  const activityReference = database.doc(`users/${ownerUid}/activity/${input.transactionId}`);
  const requestedByProduct = new Map<string, number>();
  for (const item of input.items) {
    if (!item.productId) continue;
    const next = (requestedByProduct.get(item.productId) ?? 0) + item.quantityMilli;
    if (!Number.isSafeInteger(next) || next > maxQuantityMilli) {
      throw new StockSaleError('stock_insufficient', 409, `${item.name} için istenen toplam miktar geçersiz.`);
    }
    requestedByProduct.set(item.productId, next);
  }

  await database.runTransaction(async (transaction) => {
    const [memberSnapshot, resetSnapshot, customerSnapshot, transactionSnapshot, activitySnapshot] = await Promise.all([
      transaction.get(memberReference),
      transaction.get(resetLockReference),
      transaction.get(customerReference),
      transaction.get(transactionReference),
      transaction.get(activityReference),
    ]);
    const member = memberSnapshot.data();
    if (!memberSnapshot.exists || member?.uid !== actorUid || member.active !== true
      || !['owner', 'staff'].includes(String(member.role ?? ''))) {
      throw new StockSaleError('not_member', 403, 'Bu satış için aktif işletme üyeliği gerekiyor.');
    }
    if (resetSnapshot.exists) {
      throw new StockSaleError('reset_in_progress', 409, 'Cari verileri sıfırlanırken satış yapılamaz. Biraz bekleyip tekrar deneyin.');
    }
    if (transactionSnapshot.exists || activitySnapshot.exists) {
      throw new StockSaleError('duplicate_request', 409, 'Bu satış isteği daha önce işlendi veya kimliği kullanılmış. Listeyi yenileyip kontrol edin.');
    }
    if (!customerSnapshot.exists) {
      throw new StockSaleError('customer_not_found', 404, 'Cari hesap bulunamadı. Listeyi yenileyip tekrar deneyin.');
    }
    const customer = customerSnapshot.data() ?? {};
    if ((customer.archivedAt ?? '') !== '') {
      throw new StockSaleError('customer_archived', 409, 'Arşivlenmiş cari hesaba satış kaydedilemez.');
    }
    const customerName = typeof customer.name === 'string' ? customer.name.trim() : '';
    if (!customerName) throw new StockSaleError('customer_invalid', 409, 'Cari adı doğrulanamadı.');

    const totalDebtCents = storedCents(customer.totalDebt);
    const totalPaidCents = storedCents(customer.totalPaid);
    const balanceCents = storedCents(customer.balance);
    if (totalDebtCents === null || totalPaidCents === null || balanceCents === null
      || totalDebtCents - totalPaidCents !== balanceCents) {
      throw new StockSaleError('customer_inconsistent', 409, 'Cari bakiyesi tutarsız; satış kaydedilmedi.');
    }

    const products = new Map<string, ProductState>();
    for (const [productId, requestedMilli] of requestedByProduct) {
      const productReference = database.doc(`users/${ownerUid}/inventory/${productId}`);
      const movementReference = database.doc(`users/${ownerUid}/stockActivity/${input.transactionId}_${productId}`);
      const [productSnapshot, movementSnapshot] = await Promise.all([
        transaction.get(productReference),
        transaction.get(movementReference),
      ]);
      if (!productSnapshot.exists || movementSnapshot.exists) {
        throw new StockSaleError('product_unavailable', 409, 'Satışta seçilen stok ürünü kullanılamıyor. Ürün listesini yenileyip tekrar deneyin.');
      }
      const product = productSnapshot.data() ?? {};
      const name = typeof product.name === 'string' ? product.name : '';
      const unit = typeof product.unit === 'string' ? product.unit : '';
      const priceCents = product.salePriceCents;
      const previousMilli = product.stockQuantityMilli;
      if (product.active !== true || !name || name.length > 120 || !unit || unit.length > 24
        || !Number.isSafeInteger(priceCents) || (priceCents as number) <= 0 || (priceCents as number) > maxLedgerCents
        || !Number.isSafeInteger(previousMilli) || (previousMilli as number) < 0 || (previousMilli as number) > maxQuantityMilli) {
        throw new StockSaleError('product_unavailable', 409, 'Satışta seçilen stok ürünü artık kullanılamıyor. Ürün kaydını kontrol edin.');
      }
      if (requestedMilli > (previousMilli as number)) {
        throw new StockSaleError('stock_insufficient', 409, `${name} için stok yetersiz. Güncel stok: ${((previousMilli as number) / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 3 })} ${unit}.`);
      }
      products.set(productId, {
        reference: productReference,
        movementReference,
        name,
        unit,
        priceCents: priceCents as number,
        previousMilli: previousMilli as number,
        nextMilli: (previousMilli as number) - requestedMilli,
        requestedMilli,
      });
    }

    const items: StoredSaleItem[] = input.items.map((item) => {
      if (!item.productId) return item;
      const product = products.get(item.productId);
      if (!product) throw new StockSaleError('product_unavailable', 409, 'Satış ürünü doğrulanamadı.');
      if (item.name !== product.name || item.unit !== product.unit || item.unitPriceCents !== product.priceCents) {
        throw new StockSaleError('catalog_changed', 409, `${product.name} ürününün bilgisi veya fiyatı değişmiş. Ürün satırını yeniden seçin.`);
      }
      const lineTotalCents = expectedLineTotalCents(product.priceCents, item.quantityMilli);
      if (lineTotalCents === null || lineTotalCents !== item.lineTotalCents) {
        throw new StockSaleError('catalog_changed', 409, `${product.name} ürün fiyatı güncellenmiş. Ürün satırını yeniden seçin.`);
      }
      return { ...item, name: product.name, unit: product.unit, unitPriceCents: product.priceCents, lineTotalCents };
    });
    const vat = splitVatInclusiveCents(input.amountCents);
    if (!vat) throw new StockSaleError('invalid_request', 400, 'Satış tutarı için KDV ayrıştırılamadı.');

    const nextDebtCents = totalDebtCents + input.amountCents;
    const nextBalanceCents = balanceCents + input.amountCents;
    if (!Number.isSafeInteger(nextDebtCents) || !Number.isSafeInteger(nextBalanceCents)
      || nextDebtCents > maxLedgerCents || nextBalanceCents > maxLedgerCents) {
      throw new StockSaleError('amount_limit', 409, 'Satış tutarı cari hesap için izin verilen üst sınırı aşıyor.');
    }
    const currentDueDate = typeof customer.currentDueDate === 'string' ? customer.currentDueDate : '';
    const nextDueDate = input.nextDueDate || currentDueDate;
    const stockDeltas = Object.fromEntries([...products].map(([productId, product]) => [productId, -product.requestedMilli]));
    const createdAt = FieldValue.serverTimestamp();
    const entry = {
      type: 'debt',
      amount: input.amountCents / 100,
      amountCents: input.amountCents,
      date: input.date,
      note: input.note,
      customerId: input.customerId,
      customerName,
      nextDueDate,
      items,
      ...(products.size ? { stockDeltas } : {}),
      vatRateBps: vat.vatRateBps,
      vatBaseCents: vat.vatBaseCents,
      vatCents: vat.vatCents,
      createdAt,
    };

    transaction.update(customerReference, {
      totalDebt: nextDebtCents / 100,
      totalPaid: totalPaidCents / 100,
      balance: nextBalanceCents / 100,
      lastTransactionId: input.transactionId,
      currentDueDate: nextDueDate,
      updatedAt: FieldValue.serverTimestamp(),
    });
    transaction.create(transactionReference, entry);
    transaction.create(activityReference, entry);
    for (const [productId, product] of products) {
      transaction.update(product.reference, {
        stockQuantityMilli: product.nextMilli,
        lastStockMovementId: product.movementReference.id,
        updatedAt: FieldValue.serverTimestamp(),
      });
      transaction.create(product.movementReference, {
        type: 'sale',
        productId,
        productDeltas: { [productId]: -product.requestedMilli },
        previousQuantities: { [productId]: product.previousMilli },
        nextQuantities: { [productId]: product.nextMilli },
        productNames: { [productId]: product.name },
        date: input.date,
        note: input.note,
        customerId: input.customerId,
        customerName,
        saleTransactionId: input.transactionId,
        createdBy: actorUid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
  });
}

export default async (request: Request, _context: Context): Promise<Response> => {
  if (request.method !== 'POST') return response({ error: 'method_not_allowed' }, 405);
  if (!isSameOrigin(request)) return response({ error: 'origin_not_allowed' }, 403);
  if (!(request.headers.get('content-type') ?? '').toLowerCase().startsWith('application/json')) {
    return response({ error: 'json_required' }, 415);
  }
  const tokenMatch = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!tokenMatch) return response({ error: 'unauthorized' }, 401);

  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return response({ error: 'invalid_request' }, 400);
  }
  if (new TextEncoder().encode(bodyText).byteLength > maxBodyBytes) {
    return response({ error: 'request_too_large' }, 413);
  }
  let rawInput: unknown;
  try {
    rawInput = JSON.parse(bodyText);
  } catch {
    return response({ error: 'invalid_json' }, 400);
  }

  let input: StockSaleInput;
  try {
    input = parseStockSaleInput(rawInput);
  } catch (error) {
    if (error instanceof StockSaleError) return response({ error: error.code, message: error.message }, error.status);
    return response({ error: 'invalid_request' }, 400);
  }

  const secrets = readFirebaseAdminSecrets();
  if (!secrets) return response({ error: 'function_not_configured', message: 'Satış servisi yapılandırılamadı. Netlify Function ayarlarını kontrol edin.' }, 503);
  let services: ReturnType<typeof getFirebaseAdminServices>;
  try {
    services = getFirebaseAdminServices(secrets);
  } catch {
    console.error('Firebase Admin initialization failed for stock sale endpoint.');
    return response({ error: 'function_not_configured', message: 'Satış servisi yapılandırılamadı.' }, 503);
  }

  let actorUid: string;
  try {
    const decoded = await services.adminAuth.verifyIdToken(tokenMatch[1], true);
    actorUid = decoded.uid;
  } catch {
    return response({ error: 'unauthorized' }, 401);
  }

  try {
    await applyStockSale(services.firestore, secrets.ownerUid, actorUid, input);
    return response({ transactionId: input.transactionId }, 200);
  } catch (error) {
    if (error instanceof StockSaleError) return response({ error: error.code, message: error.message }, error.status);
    console.error('Atomic stock sale transaction failed.');
    return response({ error: 'sale_failed', message: 'Satış kaydedilemedi. Stok ve cari değişmedi; listeyi yenileyip tekrar deneyin.' }, 500);
  }
};

export const config: Config = {
  path: '/api/stock/sale',
  method: ['POST'],
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: 'ip',
    windowSize: 60,
    windowLimit: 30,
  },
};
