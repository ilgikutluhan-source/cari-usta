import { parseMoneyInput, type InventoryProduct, type SaleItemInput, type StoredSaleItem } from './models';

export type InventoryProductFormValues = {
  name: string;
  sku: string;
  unit: string;
  salePrice: string;
  openingStock: string;
  lowStockThreshold: string;
};

export type InventoryProductInput = {
  name: string;
  sku: string;
  unit: string;
  salePriceCents: number;
  openingStockMilli: number;
  lowStockThresholdMilli: number;
};

export type InventoryProductParseResult =
  | { ok: true; value: InventoryProductInput }
  | { ok: false; error: string };

const maxQuantityMilli = 1_000_000_000;
const maxMoneyCents = 1_000_000_000_000;

export function parseNonNegativeQuantityMilli(raw: string): number | null {
  const value = raw.trim().replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,3})?$/.test(value)) return null;
  const [wholePart, fractionalPart = ''] = value.split('.');
  const milli = Number(wholePart) * 1000 + Number((fractionalPart + '000').slice(0, 3));
  return Number.isSafeInteger(milli) && milli >= 0 && milli <= maxQuantityMilli ? milli : null;
}

export function parseInventoryProductForm(values: InventoryProductFormValues): InventoryProductParseResult {
  const name = values.name.trim();
  const sku = values.sku.trim();
  const unit = values.unit.trim();
  if (!name || name.length > 120) return { ok: false, error: 'Ürün adı boş bırakılamaz ve en fazla 120 karakter olabilir.' };
  if (sku.length > 60) return { ok: false, error: 'Stok kodu en fazla 60 karakter olabilir.' };
  if (!unit || unit.length > 24) return { ok: false, error: 'Birim boş bırakılamaz ve en fazla 24 karakter olabilir.' };

  const parsedPrice = parseMoneyInput(values.salePrice);
  const salePriceCents = parsedPrice === null ? null : Math.round(parsedPrice * 100);
  if (salePriceCents === null || !Number.isSafeInteger(salePriceCents) || salePriceCents <= 0 || salePriceCents > maxMoneyCents) {
    return { ok: false, error: 'KDV dâhil satış fiyatını TL olarak girin; fiyat sıfırdan büyük olmalıdır.' };
  }

  const openingStockMilli = parseNonNegativeQuantityMilli(values.openingStock);
  if (openingStockMilli === null) return { ok: false, error: 'Başlangıç stoğu sıfır veya daha büyük olmalı ve en fazla 3 ondalık hane içermelidir.' };
  const lowStockThresholdMilli = parseNonNegativeQuantityMilli(values.lowStockThreshold);
  if (lowStockThresholdMilli === null) return { ok: false, error: 'Düşük stok eşiği sıfır veya daha büyük olmalı ve en fazla 3 ondalık hane içermelidir.' };

  return { ok: true, value: { name, sku, unit, salePriceCents, openingStockMilli, lowStockThresholdMilli } };
}

export function aggregateInventoryRequests(items: (Pick<SaleItemInput, 'productId' | 'quantity'> | Pick<StoredSaleItem, 'productId' | 'quantityMilli'>)[]): Map<string, number> {
  const totals = new Map<string, number>();
  for (const item of items) {
    if (!item.productId) continue;
    const quantityMilli = 'quantityMilli' in item ? item.quantityMilli : Math.round(item.quantity * 1000);
    totals.set(item.productId, (totals.get(item.productId) ?? 0) + quantityMilli);
  }
  return totals;
}

export function validateInventorySale(
  items: Pick<SaleItemInput, 'productId' | 'quantity'>[],
  products: InventoryProduct[],
): string | null {
  const requested = aggregateInventoryRequests(items);
  for (const [productId, quantityMilli] of requested) {
    const product = products.find((item) => item.id === productId && item.active);
    if (!product) return 'Satışta seçilen stok ürünü artık kullanılamıyor. Ürünü yenileyip tekrar seçin.';
    if (!Number.isSafeInteger(quantityMilli) || quantityMilli <= 0) return `${product.name} miktarını kontrol edin.`;
    if (quantityMilli > product.stockQuantityMilli) {
      return `${product.name} için istenen miktar stokta yok. Mevcut stok: ${(product.stockQuantityMilli / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 3 })} ${product.unit}.`;
    }
  }
  return null;
}
