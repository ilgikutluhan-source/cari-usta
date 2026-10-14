import { saleLineTotalCents, type SaleItemInput, type StoredSaleItem } from './models';

const maxLedgerCents = 1_000_000_000_000;
const maxProductItems = 25;

export function normalizeSaleItems(items: SaleItemInput[], amountCents: number): StoredSaleItem[] {
  if (!Array.isArray(items) || items.length < 1 || items.length > maxProductItems) {
    throw new Error(`Satış ${maxProductItems} ürün satırıyla sınırlıdır.`);
  }
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > maxLedgerCents) {
    throw new Error('Satış toplamı kuruş hassasiyetinde ve izin verilen sınırlar içinde olmalıdır.');
  }

  let totalCents = 0;
  const normalized = items.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Ürün satırı geçersiz.');
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const unit = typeof item.unit === 'string' ? item.unit.trim() : '';
    if (!name || name.length > 120 || !unit || unit.length > 24) {
      throw new Error('Ürün adı ve birimi boş bırakılamaz; uzunluk sınırlarını kontrol edin.');
    }
    const productId = item.productId;
    if (productId !== undefined && (typeof productId !== 'string' || productId.length < 1 || productId.length > 128 || productId.includes('/'))) {
      throw new Error('Seçilen stok ürünü kimliği geçersiz.');
    }
    if (typeof item.quantity !== 'number' || !Number.isFinite(item.quantity)
      || typeof item.unitPrice !== 'number' || !Number.isFinite(item.unitPrice)
      || typeof item.lineTotal !== 'number' || !Number.isFinite(item.lineTotal)) {
      throw new Error('Ürün miktarı ve fiyatı sayısal olmalıdır.');
    }

    const quantityMilli = Math.round(item.quantity * 1000);
    const unitPriceCents = Math.round(item.unitPrice * 100);
    const lineTotalCents = Math.round(item.lineTotal * 100);
    if (!Number.isSafeInteger(quantityMilli) || quantityMilli <= 0 || quantityMilli > 1_000_000_000
      || Math.abs(item.quantity - quantityMilli / 1000) > 1e-9
      || !Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0 || unitPriceCents > maxLedgerCents
      || Math.abs(item.unitPrice - unitPriceCents / 100) > 1e-8
      || !Number.isSafeInteger(lineTotalCents) || lineTotalCents < 0 || lineTotalCents > maxLedgerCents
      || Math.abs(item.lineTotal - lineTotalCents / 100) > 1e-8) {
      throw new Error('Miktar en fazla 3, fiyat ve satır toplamı en fazla 2 ondalık hane içerebilir.');
    }

    const expectedLineCents = saleLineTotalCents(unitPriceCents, quantityMilli);
    if (expectedLineCents === null || expectedLineCents !== lineTotalCents) {
      throw new Error('Ürün satır toplamı, miktar ve birim fiyatıyla eşleşmiyor.');
    }
    totalCents += lineTotalCents;
    if (!Number.isSafeInteger(totalCents) || totalCents > maxLedgerCents) {
      throw new Error('Satış toplamı cari hesap için izin verilen üst sınırı aşıyor.');
    }
    return { name, quantityMilli, unit, unitPriceCents, lineTotalCents, ...(productId ? { productId } : {}) };
  });

  if (totalCents !== amountCents) throw new Error('Satış toplamı ürün satırlarının toplamıyla eşleşmiyor.');
  return normalized;
}
