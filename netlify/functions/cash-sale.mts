import type { Config, Context } from '@netlify/functions';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { splitVatInclusiveCents, type CashSale, type CashSaleItem, type SalePaymentMethod } from '../../src/models.js';
import { getFirebaseAdminServices, readFirebaseAdminSecrets } from '../lib/firebase-admin.js';

const maxBodyBytes = 64 * 1024;
const maxAmountCents = 1_000_000_000_000;
const maxQuantityMilli = 1_000_000_000;
const allowedInputKeys = ['saleId', 'amountCents', 'date', 'note', 'paymentMethod', 'customerId', 'items'];
const allowedItemKeys = ['name', 'quantityMilli', 'unit', 'unitPriceCents', 'lineTotalCents', 'productId'];
const allowedPaymentMethods: SalePaymentMethod[] = ['cash', 'pos', 'transfer', 'other'];

type CashSaleItemInput = CashSaleItem;
type CashSaleInput = {
  saleId: string;
  amountCents: number;
  date: string;
  note: string;
  paymentMethod: SalePaymentMethod;
  customerId?: string;
  items: CashSaleItemInput[];
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

export class CashSaleError extends Error {
  constructor(readonly code: string, readonly status: number, message: string) {
    super(message);
    this.name = 'CashSaleError';
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
  if (total < 0n || total > BigInt(maxAmountCents)) return null;
  return Number(total);
}

export function parseCashSaleInput(value: unknown): CashSaleInput {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowedInputKeys.includes(key))) {
    throw new CashSaleError('invalid_request', 400, 'Peşin satış isteği geçersiz. Formu yenileyip tekrar deneyin.');
  }
  if (!safeDocumentId(value.saleId)) throw new CashSaleError('invalid_request', 400, 'Satış belge kimliği geçersiz.');
  if (!Number.isSafeInteger(value.amountCents) || (value.amountCents as number) <= 0 || (value.amountCents as number) > maxAmountCents) {
    throw new CashSaleError('invalid_request', 400, 'Peşin satış toplamı kuruş hassasiyetinde ve izin verilen sınırlar içinde olmalıdır.');
  }
  if (!isIsoDate(value.date)) throw new CashSaleError('invalid_request', 400, 'Satış tarihi geçersiz.');
  if (typeof value.note !== 'string' || value.note.trim().length > 180) {
    throw new CashSaleError('invalid_request', 400, 'Açıklama en fazla 180 karakter olabilir.');
  }
  if (typeof value.paymentMethod !== 'string' || !allowedPaymentMethods.includes(value.paymentMethod as SalePaymentMethod)) {
    throw new CashSaleError('invalid_request', 400, 'Ödeme yöntemi geçersiz.');
  }
  const customerId = value.customerId;
  if (customerId !== undefined && !safeDocumentId(customerId)) {
    throw new CashSaleError('invalid_request', 400, 'Seçilen müşteri kimliği geçersiz.');
  }
  if (!Array.isArray(value.items) || value.items.length < 1 || value.items.length > 25) {
    throw new CashSaleError('invalid_request', 400, 'Peşin satış 1–25 ürün satırıyla sınırlıdır.');
  }

  const items = value.items.map((rawItem): CashSaleItemInput => {
    if (!isRecord(rawItem) || Object.keys(rawItem).some((key) => !allowedItemKeys.includes(key))) {
      throw new CashSaleError('invalid_request', 400, 'Satış ürün satırı geçersiz.');
    }
    const name = typeof rawItem.name === 'string' ? rawItem.name.trim() : '';
    const unit = typeof rawItem.unit === 'string' ? rawItem.unit.trim() : '';
    const quantityMilli = rawItem.quantityMilli;
    const unitPriceCents = rawItem.unitPriceCents;
    const lineTotalCents = rawItem.lineTotalCents;
    const productId = rawItem.productId;
    if (!name || name.length > 120 || !unit || unit.length > 24 || !safeDocumentId(productId)
      || !Number.isSafeInteger(quantityMilli) || (quantityMilli as number) <= 0 || (quantityMilli as number) > maxQuantityMilli
      || !Number.isSafeInteger(unitPriceCents) || (unitPriceCents as number) <= 0 || (unitPriceCents as number) > maxAmountCents
      || !Number.isSafeInteger(lineTotalCents) || (lineTotalCents as number) < 0 || (lineTotalCents as number) > maxAmountCents) {
      throw new CashSaleError('invalid_request', 400, 'Stok ürünü, miktarı veya fiyatı geçersiz.');
    }
    const expected = expectedLineTotalCents(unitPriceCents as number, quantityMilli as number);
    if (expected === null || expected !== lineTotalCents) {
      throw new CashSaleError('invalid_request', 400, 'Ürün satır toplamı miktar ve birim fiyatıyla eşleşmiyor.');
    }
    return {
      name,
      unit,
      quantityMilli: quantityMilli as number,
      unitPriceCents: unitPriceCents as number,
      lineTotalCents: lineTotalCents as number,
      productId,
    };
  });

  const amountCents = value.amountCents as number;
  const itemTotalCents = items.reduce((total, item) => total + item.lineTotalCents, 0);
  if (!Number.isSafeInteger(itemTotalCents) || itemTotalCents !== amountCents) {
    throw new CashSaleError('invalid_request', 400, 'Peşin satış toplamı ürün satırlarının toplamıyla eşleşmiyor.');
  }

  return {
    saleId: value.saleId,
    amountCents,
    date: value.date,
    note: value.note.trim(),
    paymentMethod: value.paymentMethod as SalePaymentMethod,
    ...(typeof customerId === 'string' ? { customerId } : {}),
    items,
  };
}

function cashSaleRequestMatches(existing: Record<string, unknown>, input: CashSaleInput): boolean {
  if (existing.date !== input.date || existing.note !== input.note
    || existing.amountCents !== input.amountCents || existing.paymentMethod !== input.paymentMethod
    || (existing.customerId ?? '') !== (input.customerId ?? '')
    || !Array.isArray(existing.items) || existing.items.length !== input.items.length) return false;
  return existing.items.every((rawItem, index) => {
    if (!isRecord(rawItem)) return false;
    const requested = input.items[index];
    return rawItem.productId === requested.productId
      && rawItem.name === requested.name
      && rawItem.unit === requested.unit
      && rawItem.quantityMilli === requested.quantityMilli
      && rawItem.unitPriceCents === requested.unitPriceCents
      && rawItem.lineTotalCents === requested.lineTotalCents;
  });
}

export async function applyCashSale(database: Firestore, ownerUid: string, actorUid: string, input: CashSaleInput): Promise<CashSale> {
  const saleReference = database.doc(`users/${ownerUid}/cashSales/${input.saleId}`);
  const memberReference = database.doc(`users/${ownerUid}/members/${actorUid}`);
  const resetLockReference = database.doc(`users/${ownerUid}/system/ledgerReset`);
  const requestedByProduct = new Map<string, number>();
  for (const item of input.items) {
    const next = (requestedByProduct.get(item.productId) ?? 0) + item.quantityMilli;
    if (!Number.isSafeInteger(next) || next > maxQuantityMilli) {
      throw new CashSaleError('stock_insufficient', 409, `${item.name} için istenen toplam miktar geçersiz.`);
    }
    requestedByProduct.set(item.productId, next);
  }

  let createdSale: CashSale | null = null;
  await database.runTransaction(async (transaction) => {
    const [memberSnapshot, resetSnapshot, saleSnapshot] = await Promise.all([
      transaction.get(memberReference),
      transaction.get(resetLockReference),
      transaction.get(saleReference),
    ]);
    const member = memberSnapshot.data();
    if (!memberSnapshot.exists || member?.uid !== actorUid || member.active !== true
      || !['owner', 'staff'].includes(String(member.role ?? ''))) {
      throw new CashSaleError('not_member', 403, 'Bu satış için aktif işletme üyeliği gerekiyor.');
    }
    if (resetSnapshot.exists) throw new CashSaleError('reset_in_progress', 409, 'Cari verileri sıfırlanırken satış yapılamaz. Biraz bekleyip tekrar deneyin.');
    if (saleSnapshot.exists) {
      const existing = saleSnapshot.data() ?? {};
      if (!cashSaleRequestMatches(existing, input)) {
        throw new CashSaleError('duplicate_request', 409, 'Bu belge numarası farklı bir satış için kullanılmış. Satış listesini yenileyip kontrol edin.');
      }
      createdSale = { ...existing, id: input.saleId } as unknown as CashSale;
      return;
    }

    let customerSnapshot: FirebaseFirestore.DocumentSnapshot | null = null;
    if (input.customerId) {
      customerSnapshot = await transaction.get(database.doc(`users/${ownerUid}/customers/${input.customerId}`));
      if (!customerSnapshot.exists) throw new CashSaleError('customer_not_found', 404, 'Seçilen müşteri bulunamadı. Listeyi yenileyip tekrar deneyin.');
      const customer = customerSnapshot.data() ?? {};
      if (customer.archivedAt) throw new CashSaleError('customer_archived', 409, 'Arşivlenmiş müşteriyle peşin satış kaydedilemez.');
      if (typeof customer.name !== 'string' || !customer.name.trim()) throw new CashSaleError('customer_invalid', 409, 'Müşteri bilgisi doğrulanamadı.');
    }

    const products = new Map<string, ProductState>();
    for (const [productId, requestedMilli] of requestedByProduct) {
      const productReference = database.doc(`users/${ownerUid}/inventory/${productId}`);
      const movementId = `cash_${input.saleId}_${productId}`;
      if (movementId.length > 200) throw new CashSaleError('invalid_request', 400, 'Stok hareket kimliği izin verilen uzunluğu aşıyor.');
      const movementReference = database.doc(`users/${ownerUid}/stockActivity/${movementId}`);
      const [productSnapshot, movementSnapshot] = await Promise.all([
        transaction.get(productReference),
        transaction.get(movementReference),
      ]);
      if (!productSnapshot.exists || movementSnapshot.exists) {
        throw new CashSaleError('product_unavailable', 409, 'Satışta seçilen stok ürünü kullanılamıyor. Ürün listesini yenileyip tekrar deneyin.');
      }
      const product = productSnapshot.data() ?? {};
      const name = typeof product.name === 'string' ? product.name : '';
      const unit = typeof product.unit === 'string' ? product.unit : '';
      const priceCents = product.salePriceCents;
      const previousMilli = product.stockQuantityMilli;
      if (product.active !== true || !name || name.length > 120 || !unit || unit.length > 24
        || !Number.isSafeInteger(priceCents) || (priceCents as number) <= 0 || (priceCents as number) > maxAmountCents
        || !Number.isSafeInteger(previousMilli) || (previousMilli as number) < 0 || (previousMilli as number) > maxQuantityMilli) {
        throw new CashSaleError('product_unavailable', 409, 'Satış ürünü artık aktif veya geçerli değil. Ürün kaydını kontrol edin.');
      }
      if (requestedMilli > (previousMilli as number)) {
        throw new CashSaleError('stock_insufficient', 409, `${name} için stok yetersiz. Güncel stok: ${((previousMilli as number) / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 3 })} ${unit}.`);
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

    const items: CashSaleItem[] = input.items.map((item) => {
      const product = products.get(item.productId);
      if (!product || item.name !== product.name || item.unit !== product.unit || item.unitPriceCents !== product.priceCents) {
        throw new CashSaleError('catalog_changed', 409, 'Ürün bilgisi veya fiyatı değişmiş. Ürünü yeniden seçip tekrar deneyin.');
      }
      const lineTotalCents = expectedLineTotalCents(product.priceCents, item.quantityMilli);
      if (lineTotalCents === null || lineTotalCents !== item.lineTotalCents) {
        throw new CashSaleError('catalog_changed', 409, `${product.name} fiyatı değişmiş. Ürünü yeniden seçip tekrar deneyin.`);
      }
      return { ...item, name: product.name, unit: product.unit, unitPriceCents: product.priceCents, lineTotalCents };
    });
    const vat = splitVatInclusiveCents(input.amountCents);
    if (!vat) throw new CashSaleError('invalid_request', 400, 'Satış tutarı için KDV ayrıştırılamadı.');
    const invoiceNumber = `PS-${input.date.replaceAll('-', '')}-${input.saleId.slice(-8).toLocaleUpperCase('tr-TR')}`;
    const customerData = customerSnapshot?.data();
    const saleWithoutTimestamp: Omit<CashSale, 'createdAt'> = {
      id: input.saleId,
      invoiceNumber,
      date: input.date,
      note: input.note,
      amountCents: input.amountCents,
      items,
      vatRateBps: vat.vatRateBps,
      vatBaseCents: vat.vatBaseCents,
      vatCents: vat.vatCents,
      paymentMethod: input.paymentMethod,
      ...(input.customerId ? {
        customerId: input.customerId,
        customerName: String(customerData?.name ?? '').trim(),
        customerPhone: String(customerData?.phone ?? '').trim(),
        customerCompany: String(customerData?.company ?? '').trim(),
      } : {}),
      createdBy: actorUid,
    };

    transaction.create(saleReference, { ...saleWithoutTimestamp, createdAt: FieldValue.serverTimestamp() });
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
        note: `Peşin satış · ${invoiceNumber}`,
        cashSaleId: input.saleId,
        createdBy: actorUid,
        createdAt: FieldValue.serverTimestamp(),
      });
    }
    createdSale = saleWithoutTimestamp;
  });

  if (!createdSale) throw new CashSaleError('sale_failed', 500, 'Peşin satış kaydedilemedi. Stok değişmedi.');
  return createdSale;
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
  try { bodyText = await request.text(); }
  catch { return response({ error: 'invalid_request' }, 400); }
  if (new TextEncoder().encode(bodyText).byteLength > maxBodyBytes) return response({ error: 'request_too_large' }, 413);

  let rawInput: unknown;
  try { rawInput = JSON.parse(bodyText); }
  catch { return response({ error: 'invalid_json' }, 400); }

  let input: CashSaleInput;
  try { input = parseCashSaleInput(rawInput); }
  catch (error) {
    if (error instanceof CashSaleError) return response({ error: error.code, message: error.message }, error.status);
    return response({ error: 'invalid_request' }, 400);
  }

  const secrets = readFirebaseAdminSecrets();
  if (!secrets) return response({ error: 'function_not_configured', message: 'Peşin satış servisi yapılandırılamadı. Netlify Function ayarlarını kontrol edin.' }, 503);
  let services: ReturnType<typeof getFirebaseAdminServices>;
  try { services = getFirebaseAdminServices(secrets); }
  catch {
    console.error('Firebase Admin initialization failed for cash sale endpoint.');
    return response({ error: 'function_not_configured', message: 'Peşin satış servisi yapılandırılamadı.' }, 503);
  }

  let actorUid: string;
  try { actorUid = (await services.adminAuth.verifyIdToken(tokenMatch[1], true)).uid; }
  catch { return response({ error: 'unauthorized' }, 401); }

  try {
    const sale = await applyCashSale(services.firestore, secrets.ownerUid, actorUid, input);
    return response({ sale }, 200);
  } catch (error) {
    if (error instanceof CashSaleError) return response({ error: error.code, message: error.message }, error.status);
    console.error('Atomic cash sale transaction failed.');
    return response({ error: 'sale_failed', message: 'Peşin satış kaydedilemedi. Stok değişmedi; listeyi yenileyip tekrar deneyin.' }, 500);
  }
};

export const config: Config = {
  path: '/api/cash/sale',
  method: ['POST'],
  rateLimit: {
    action: 'rate_limit',
    aggregateBy: 'ip',
    windowSize: 60,
    windowLimit: 30,
  },
};
