import { parseQuantityMilli, saleLineTotalCents, type CashSaleItem, type InventoryProduct } from './models';

const maxItems = 25;
const maxAmountCents = 1_000_000_000_000;
const maxQuantityMilli = 1_000_000_000;

export type CashSaleDraftRow = { id: string; productId: string; quantity: string };
export type CashSaleLinesResult =
  | { ok: true; items: CashSaleItem[]; amountCents: number }
  | { ok: false; error: string };

export function buildCashSaleLines(rows: CashSaleDraftRow[], products: InventoryProduct[]): CashSaleLinesResult {
  if (!Array.isArray(rows) || rows.length < 1) return { ok: false, error: 'Peşin satış için stoktan en az bir ürün seçin.' };
  if (rows.length > maxItems) return { ok: false, error: `Bir satış en fazla ${maxItems} ürün satırı içerebilir.` };

  const requests = new Map<string, number>();
  const items: CashSaleItem[] = [];
  let amountCents = 0;

  for (const row of rows) {
    const product = products.find((item) => item.id === row.productId && item.active);
    if (!product) return { ok: false, error: 'Seçilen stok ürünü artık kullanılamıyor. Ürün listesini yenileyip tekrar seçin.' };
    const quantityMilli = parseQuantityMilli(row.quantity);
    if (quantityMilli === null || quantityMilli <= 0 || quantityMilli > maxQuantityMilli) {
      return { ok: false, error: `${product.name} miktarını kontrol edin; en fazla 3 ondalık hane kullanılabilir.` };
    }
    const totalRequested = (requests.get(product.id) ?? 0) + quantityMilli;
    if (!Number.isSafeInteger(totalRequested) || totalRequested > maxQuantityMilli) {
      return { ok: false, error: `${product.name} için toplam miktar izin verilen sınırı aşıyor.` };
    }
    requests.set(product.id, totalRequested);
    const lineTotalCents = saleLineTotalCents(product.salePriceCents, quantityMilli);
    if (lineTotalCents === null || !Number.isSafeInteger(lineTotalCents) || lineTotalCents < 0) {
      return { ok: false, error: `${product.name} satır toplamı hesaplanamadı.` };
    }
    amountCents += lineTotalCents;
    if (!Number.isSafeInteger(amountCents) || amountCents > maxAmountCents) {
      return { ok: false, error: 'Peşin satış toplamı izin verilen üst sınırı aşıyor.' };
    }
    items.push({
      name: product.name,
      quantityMilli,
      unit: product.unit,
      unitPriceCents: product.salePriceCents,
      lineTotalCents,
      productId: product.id,
    });
  }

  for (const [productId, quantityMilli] of requests) {
    const product = products.find((item) => item.id === productId);
    if (!product || quantityMilli > product.stockQuantityMilli) {
      const available = product ? (product.stockQuantityMilli / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 3 }) : '0';
      return { ok: false, error: `${product?.name ?? 'Ürün'} için stok yetersiz. Güncel stok: ${available} ${product?.unit ?? ''}.` };
    }
  }

  if (amountCents <= 0) return { ok: false, error: 'Peşin satış toplamı sıfırdan büyük olmalıdır.' };
  return { ok: true, items, amountCents };
}
