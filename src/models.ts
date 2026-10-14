export type Customer = {
  id: string;
  name: string;
  phone: string;
  company: string;
  note: string;
  currentDueDate: string;
  totalDebt: number;
  totalPaid: number;
  balance: number;
  archivedAt?: string;
};

export type EntryType = 'debt' | 'payment' | 'due_update' | 'sale';
export type SalePaymentMethod = 'cash' | 'pos' | 'transfer' | 'other';
export const VAT_RATE_BPS = 2_000;

export type VatBreakdown = {
  grossCents: number;
  vatBaseCents: number;
  vatCents: number;
  vatRateBps: number;
};

/** Splits a VAT-inclusive gross amount at the fixed 20% rate without changing its kuruş total. */
export function splitVatInclusiveCents(grossCents: number): VatBreakdown | null {
  if (!Number.isSafeInteger(grossCents) || grossCents < 0 || grossCents > 1_000_000_000_000) return null;
  const vatBaseCents = Math.round(grossCents * 5 / 6);
  return {
    grossCents,
    vatBaseCents,
    vatCents: grossCents - vatBaseCents,
    vatRateBps: VAT_RATE_BPS,
  };
}

export type SaleItemInput = {
  name: string;
  quantity: number;
  unit: string;
  unitPrice: number;
  lineTotal: number;
  productId?: string;
};

export type StoredSaleItem = {
  name: string;
  quantityMilli: number;
  unit: string;
  unitPriceCents: number;
  lineTotalCents: number;
  productId?: string;
};

export type CashSaleItem = StoredSaleItem & { productId: string };

export type SaleItem = SaleItemInput | StoredSaleItem;

export type InventoryProduct = {
  id: string;
  name: string;
  sku: string;
  unit: string;
  salePriceCents: number;
  stockQuantityMilli: number;
  lowStockThresholdMilli: number;
  active: boolean;
  lastStockMovementId: string;
  createdBy: string;
  createdAt?: Date | string | { seconds: number; nanoseconds?: number; toMillis: () => number };
  updatedAt?: Date | string | { seconds: number; nanoseconds?: number; toMillis: () => number };
};

export type StockMovementType = 'opening' | 'receipt' | 'adjustment' | 'sale';

export type StockMovement = {
  id: string;
  type: StockMovementType;
  productDeltas: Record<string, number>;
  previousQuantities: Record<string, number>;
  nextQuantities: Record<string, number>;
  productNames: Record<string, string>;
  date: string;
  note: string;
  createdBy?: string;
  createdAt?: Date | string | { seconds: number; nanoseconds?: number; toMillis: () => number };
  customerId?: string;
  customerName?: string;
  saleTransactionId?: string;
  cashSaleId?: string;
};

export type CashSale = {
  id: string;
  invoiceNumber: string;
  date: string;
  note: string;
  amountCents: number;
  items: CashSaleItem[];
  vatRateBps: number;
  vatBaseCents: number;
  vatCents: number;
  paymentMethod: SalePaymentMethod;
  customerId?: string;
  customerName?: string;
  customerPhone?: string;
  customerCompany?: string;
  createdBy?: string;
  createdAt?: Date | string | { seconds: number; nanoseconds?: number; toMillis: () => number };
};

export type CashSaleCreateInput = Pick<CashSale, 'date' | 'note' | 'amountCents' | 'items' | 'paymentMethod'> & {
  saleId?: string;
  customerId?: string;
};

export const saleItemQuantity = (item: SaleItem) =>
  'quantityMilli' in item ? item.quantityMilli / 1000 : item.quantity;

export const saleItemUnitPrice = (item: SaleItem) =>
  'unitPriceCents' in item ? item.unitPriceCents / 100 : item.unitPrice;

export const saleItemLineTotal = (item: SaleItem) =>
  'lineTotalCents' in item ? item.lineTotalCents / 100 : item.lineTotal;

export type LedgerEntry = {
  id: string;
  type: EntryType;
  amount: number;
  amountCents?: number;
  date: string;
  note: string;
  customerId: string;
  customerName?: string;
  previousDueDate?: string;
  nextDueDate?: string;
  items?: SaleItem[];
  vatRateBps?: number;
  vatBaseCents?: number;
  vatCents?: number;
  paidNow?: number;
  paidNowCents?: number;
  remainingAtSale?: number;
  remainingCents?: number;
  paymentMethod?: SalePaymentMethod | null;
  stockDeltas?: Record<string, number>;
  createdBy?: string;
  clientRequestId?: string;
  createdAt?: Date | string | { seconds: number; nanoseconds?: number; toMillis: () => number };
};

/** Uses stored tax fields when present; legacy itemized sales use the user's configured 20% rate. */
export function saleVatBreakdown(entry: LedgerEntry): VatBreakdown | null {
  const grossCents = Number.isSafeInteger(entry.amountCents)
    ? entry.amountCents ?? 0
    : Math.round(entry.amount * 100);
  if (!Number.isSafeInteger(grossCents) || grossCents < 0) return null;

  if (entry.vatRateBps !== undefined) {
    if (entry.vatRateBps !== VAT_RATE_BPS
      || !Number.isSafeInteger(entry.vatBaseCents)
      || !Number.isSafeInteger(entry.vatCents)
      || (entry.vatBaseCents ?? -1) < 0
      || (entry.vatCents ?? -1) < 0
      || (entry.vatBaseCents ?? 0) + (entry.vatCents ?? 0) !== grossCents) return null;
    return {
      grossCents,
      vatBaseCents: entry.vatBaseCents ?? 0,
      vatCents: entry.vatCents ?? 0,
      vatRateBps: entry.vatRateBps,
    };
  }

  return entry.type === 'sale' || Boolean(entry.items?.length)
    ? splitVatInclusiveCents(grossCents)
    : null;
}

export type DemoStore = {
  customers: Customer[];
  entries: LedgerEntry[];
  products?: InventoryProduct[];
  stockActivity?: StockMovement[];
  cashSales?: CashSale[];
};

export const todayIso = () => {
  const date = new Date();
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

export const dateOffset = (days: number) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
};

export const parseDate = (value?: string) => value ? new Date(`${value}T12:00:00`) : null;

export const formatDate = (value?: string) => {
  const date = parseDate(value);
  return date && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
    : 'Tarih yok';
};

const isThreeDigitGrouping = (parts: string[]) =>
  parts.length > 1
  && parts[0].length >= 1
  && parts[0].length <= 3
  && parts.every((part, index) => /^\d+$/.test(part) && (index === 0 || part.length === 3));

const isAutoGroupedIntegerContinuation = (parts: string[]) =>
  parts.length >= 2
  && parts[0].length >= 1
  && parts[0].length <= 3
  && /^\d+$/.test(parts[0])
  && parts.slice(1, -1).every((part) => /^\d{3}$/.test(part))
  && /^\d{4,}$/.test(parts[parts.length - 1]);

/** Parses a TL input string with Turkish decimal-comma conventions into exact kuruş precision. */
export const parseMoneyInput = (raw: string): number | null => {
  const value = raw.trim().replace(/(?:₺|TRY|TL)/gi, '').replace(/[\s\u00a0]/g, '');
  if (!value || !/^[\d.,]+$/.test(value)) return null;

  const comma = value.lastIndexOf(',');
  const dot = value.lastIndexOf('.');
  let decimalSeparator: ',' | '.' | null = null;
  let groupSeparator: ',' | '.' | null = null;

  if (comma >= 0 && dot >= 0) {
    decimalSeparator = comma > dot ? ',' : '.';
    groupSeparator = decimalSeparator === ',' ? '.' : ',';
  } else if (comma >= 0) {
    decimalSeparator = ',';
  } else if (dot >= 0) {
    const parts = value.split('.');
    if (isThreeDigitGrouping(parts) || isAutoGroupedIntegerContinuation(parts)) {
      groupSeparator = '.';
    } else {
      decimalSeparator = '.';
    }
  }

  let wholePart = value;
  let fractionalPart = '';
  if (decimalSeparator) {
    const separatorIndex = value.lastIndexOf(decimalSeparator);
    wholePart = value.slice(0, separatorIndex);
    fractionalPart = value.slice(separatorIndex + 1);
    if (!/^\d{1,2}$/.test(fractionalPart)) return null;
  }

  if (groupSeparator) {
    const groups = wholePart.split(groupSeparator);
    const validGrouping = (groups.length > 1
      && groups[0].length >= 1
      && groups[0].length <= 3
      && groups.every((part, index) => /^\d+$/.test(part) && (index === 0 || part.length === 3)))
      || (groupSeparator === '.' && isAutoGroupedIntegerContinuation(groups));
    if (!validGrouping) return null;
    wholePart = groups.join('');
  }

  if (wholePart && !/^\d+$/.test(wholePart)) return null;
  const whole = Number(wholePart || '0');
  const kuruş = Number((fractionalPart + '00').slice(0, 2));
  const cents = whole * 100 + kuruş;
  if (!Number.isSafeInteger(cents)) return null;
  return cents / 100;
};

/** Formats a partially typed TL value: grouping appears automatically and decimals use a comma. */
export const formatMoneyInput = (raw: string): string => {
  const value = raw.trim().replace(/(?:₺|TRY|TL)/gi, '').replace(/[\s\u00a0]/g, '').replace(/[^\d.,]/g, '');
  if (!value) return '';

  const comma = value.lastIndexOf(',');
  const dot = value.lastIndexOf('.');
  let decimalSeparator: ',' | '.' | null = null;
  if (comma >= 0 && dot >= 0) {
    decimalSeparator = comma > dot ? ',' : '.';
  } else if (comma >= 0) {
    decimalSeparator = ',';
  } else if (dot >= 0) {
    if (value.endsWith('.')) decimalSeparator = '.';
    else {
      const parts = value.split('.');
      if (!isThreeDigitGrouping(parts) && !isAutoGroupedIntegerContinuation(parts)) decimalSeparator = '.';
    }
  }

  const separatorIndex = decimalSeparator ? value.lastIndexOf(decimalSeparator) : -1;
  const wholeRaw = separatorIndex >= 0 ? value.slice(0, separatorIndex) : value;
  const fractionRaw = separatorIndex >= 0 ? value.slice(separatorIndex + 1) : '';
  const wholeDigits = wholeRaw.replace(/\D/g, '');
  const groupedWhole = wholeDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const fraction = fractionRaw.replace(/\D/g, '').slice(0, 24);
  return `${groupedWhole}${decimalSeparator ? `,${fraction}` : ''}`;
};

/** Removes thousands separators for editing while preserving any Turkish decimal comma. */
export const ungroupMoneyInput = (raw: string): string => {
  const formatted = formatMoneyInput(raw);
  const commaIndex = formatted.lastIndexOf(',');
  if (commaIndex < 0) return formatted.replace(/\./g, '');
  const whole = formatted.slice(0, commaIndex).replace(/\./g, '');
  return `${whole},${formatted.slice(commaIndex + 1)}`;
};

const groupDigits = (digits: string, sizes: number[]): string => {
  const groups: string[] = [];
  let offset = 0;
  for (const size of sizes) {
    if (offset >= digits.length) break;
    groups.push(digits.slice(offset, offset + size));
    offset += size;
  }
  return groups.join(' ');
};

/** Formats Turkish domestic mobile numbers as 0532 410 28 16 while typing; accepts +90/0090 too. */
export const formatTurkishPhoneInput = (raw: string): string => {
  const text = raw.trim();
  const digits = text.replace(/\D/g, '');
  if (!digits) return text.startsWith('+') ? '+' : '';

  if (text.startsWith('+') && '90'.startsWith(digits) && digits.length < 2) return `+${digits}`;
  if (text.startsWith('+') && digits.startsWith('90')) {
    const local = digits.slice(2, 12);
    return local ? `+90 ${groupDigits(local, [3, 3, 2, 2])}` : '+90';
  }
  if (digits.startsWith('0090')) {
    const local = digits.slice(4, 14);
    return local ? `+90 ${groupDigits(local, [3, 3, 2, 2])}` : '+90';
  }
  if (digits.startsWith('90') && digits.length > 10) {
    const local = digits.slice(2, 12);
    return local ? `+90 ${groupDigits(local, [3, 3, 2, 2])}` : '+90';
  }

  const local = (digits.startsWith('0') ? digits.slice(1) : digits).slice(0, 10);
  const domestic = `0${local}`.slice(0, 11);
  return groupDigits(domestic, [4, 3, 2, 2]);
};

/** Keeps a useful caret position when a controlled input inserts grouping punctuation. */
export const formatInputValueAndCaret = (
  raw: string,
  caret: number,
  formatter: (value: string) => string,
  leadingDigitOffset = 0,
): { value: string; caret: number } => {
  const value = formatter(raw);
  const prefix = raw.slice(0, caret);
  const rawDigitCount = (prefix.match(/\d/g) ?? []).length;
  const formattedDigitCount = (value.match(/\d/g) ?? []).length;
  const targetDigitCount = Math.min(formattedDigitCount, rawDigitCount + leadingDigitOffset);

  let nextCaret = 0;
  if (targetDigitCount === 0) {
    nextCaret = value.startsWith('+') ? 1 : 0;
  } else {
    let seen = 0;
    for (let index = 0; index < value.length; index += 1) {
      if (/\d/.test(value[index])) seen += 1;
      if (seen === targetDigitCount) {
        nextCaret = index + 1;
        break;
      }
    }
    while (value[nextCaret] === ' ') nextCaret += 1;
  }

  if (/[,.]$/.test(prefix) && value.includes(',')) {
    nextCaret = value.indexOf(',') + 1;
  }
  return { value, caret: Math.min(nextCaret, value.length) };
};

/** Parses a localized product quantity into thousandths (e.g. 1,25 -> 1250). */
export const parseQuantityMilli = (raw: string): number | null => {
  const value = raw.trim().replace(/[\s\u00a0]/g, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,3})?$/.test(value)) return null;
  const [wholePart, fractionalPart = ''] = value.split('.');
  const milli = Number(wholePart) * 1000 + Number((fractionalPart + '000').slice(0, 3));
  if (!Number.isSafeInteger(milli) || milli <= 0 || milli > 1_000_000_000) return null;
  return milli;
};

/** Computes a sale line total in kuruş with integer arithmetic. */
export const saleLineTotalCents = (unitPriceCents: number, quantityMilli: number): number | null => {
  if (!Number.isSafeInteger(unitPriceCents) || unitPriceCents < 0
    || !Number.isSafeInteger(quantityMilli) || quantityMilli <= 0) return null;
  const product = unitPriceCents * quantityMilli;
  if (!Number.isSafeInteger(product)) return null;
  return Math.round(product / 1000);
};

export const formatQuantity = (value: number) => new Intl.NumberFormat('tr-TR', {
  maximumFractionDigits: 3,
}).format(value);

export const paymentMethodLabel = (method?: SalePaymentMethod | null) => ({
  cash: 'Nakit',
  pos: 'Kart / POS',
  transfer: 'Havale / EFT',
  other: 'Diğer',
}[method ?? 'other']);

export const money = (value: number) => new Intl.NumberFormat('tr-TR', {
  style: 'currency', currency: 'TRY', currencyDisplay: 'symbol',
  minimumFractionDigits: 2, maximumFractionDigits: 2,
}).format(value || 0);

export const makeDemoStore = (): DemoStore => {
  const products: InventoryProduct[] = [
    { id: 'demo-product-1', name: 'Seramik yapıştırıcısı', sku: 'YAPI-001', unit: 'adet', salePriceCents: 125_000, stockQuantityMilli: 25_000, lowStockThresholdMilli: 5_000, active: true, lastStockMovementId: 'demo-stock-1', createdBy: 'demo' },
    { id: 'demo-product-2', name: 'Saten alçı 20 kg', sku: 'YAPI-002', unit: 'çuval', salePriceCents: 45_500, stockQuantityMilli: 38_000, lowStockThresholdMilli: 8_000, active: true, lastStockMovementId: 'demo-stock-2', createdBy: 'demo' },
    { id: 'demo-product-3', name: 'İç cephe boyası 15 L', sku: 'YAPI-003', unit: 'kova', salePriceCents: 895_000, stockQuantityMilli: 4_000, lowStockThresholdMilli: 6_000, active: true, lastStockMovementId: 'demo-stock-3', createdBy: 'demo' },
  ];
  const stockActivity: StockMovement[] = products.map((product, index) => ({
    id: `demo-stock-${index + 1}`,
    type: 'opening',
    productDeltas: { [product.id]: product.stockQuantityMilli },
    previousQuantities: { [product.id]: 0 },
    nextQuantities: { [product.id]: product.stockQuantityMilli },
    productNames: { [product.id]: product.name },
    date: dateOffset(0),
    note: 'Örnek açılış stoku',
    createdBy: 'demo',
  }));
  const customers: Customer[] = [
    { id: 'demo-1', name: 'Ahmet Yılmaz', phone: '0532 410 28 16', company: 'Yılmaz İnşaat', note: 'Şantiye teslimatı', currentDueDate: dateOffset(-3), totalDebt: 86_500, totalPaid: 31_500, balance: 55_000 },
    { id: 'demo-2', name: 'Zeynep Demir', phone: '0541 236 70 44', company: 'Demir Dekorasyon', note: '', currentDueDate: dateOffset(4), totalDebt: 42_800, totalPaid: 18_000, balance: 24_800 },
    { id: 'demo-3', name: 'Mehmet Kaya', phone: '0505 681 43 29', company: 'Kaya Yapı', note: 'Fiyat listesi gönderildi', currentDueDate: dateOffset(12), totalDebt: 127_400, totalPaid: 72_400, balance: 55_000 },
    { id: 'demo-4', name: 'Elif Çelik', phone: '0538 902 11 73', company: 'Çelik Tadilat', note: '', currentDueDate: dateOffset(1), totalDebt: 18_750, totalPaid: 18_750, balance: 0 },
    { id: 'demo-5', name: 'Murat Özkan', phone: '0553 147 95 02', company: 'Özkan Proje', note: 'Toplu alım', currentDueDate: dateOffset(8), totalDebt: 63_200, totalPaid: 12_000, balance: 51_200 },
  ];
  const entries: LedgerEntry[] = [
    { id: 'entry-1', type: 'payment', amount: 7_500, date: dateOffset(0), note: 'Havale', customerId: 'demo-2', customerName: 'Zeynep Demir' },
    { id: 'entry-2', type: 'debt', amount: 12_800, date: dateOffset(-1), note: 'Seramik ve derz dolgu', customerId: 'demo-3', customerName: 'Mehmet Kaya' },
    { id: 'entry-3', type: 'payment', amount: 10_000, date: dateOffset(-2), note: 'Nakit tahsilat', customerId: 'demo-1', customerName: 'Ahmet Yılmaz' },
    { id: 'entry-4', type: 'debt', amount: 4_250, date: dateOffset(-3), note: 'Boya ve rulo seti', customerId: 'demo-5', customerName: 'Murat Özkan' },
    { id: 'entry-5', type: 'payment', amount: 8_750, date: dateOffset(-4), note: 'Kartla ödeme', customerId: 'demo-4', customerName: 'Elif Çelik' },
  ];
  return { customers, entries, products, stockActivity };
};
