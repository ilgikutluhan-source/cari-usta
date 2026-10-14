import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  formatDate,
  formatQuantity,
  money,
  paymentMethodLabel,
  saleItemLineTotal,
  saleItemQuantity,
  saleItemUnitPrice,
  saleVatBreakdown,
  todayIso,
  type CashSale,
  type Customer,
  type LedgerEntry,
  type VatBreakdown,
} from '../models';

export type CustomerPrintMode = { kind: 'statement' } | { kind: 'sale'; saleId: string };
type CustomerPrintProps = {
  customer: Customer;
  entries: LedgerEntry[];
  mode: CustomerPrintMode;
  onDone: () => void;
};
type PrintRow = { entry: LedgerEntry; balanceAfterCents: number | null };

const isSalesDocument = (entry: LedgerEntry) =>
  entry.type === 'sale' || Boolean(entry.items?.length) || entry.vatRateBps === 2_000;

function entryCreatedAtMillis(entry: LedgerEntry): number {
  const createdAt = entry.createdAt;
  if (!createdAt) return 0;
  if (createdAt instanceof Date) return createdAt.getTime();
  if (typeof createdAt === 'string') {
    const parsed = Date.parse(createdAt);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (typeof createdAt.toMillis === 'function') return createdAt.toMillis();
  if (typeof createdAt.seconds === 'number') {
    return createdAt.seconds * 1000 + (createdAt.nanoseconds ?? 0) / 1_000_000;
  }
  return 0;
}

function entryAmountCents(entry: LedgerEntry): number {
  if (Number.isSafeInteger(entry.amountCents) && (entry.amountCents ?? -1) >= 0) {
    return entry.amountCents ?? 0;
  }
  return Math.round(entry.amount * 100);
}

function paidNowCents(entry: LedgerEntry): number {
  return Number.isSafeInteger(entry.paidNowCents)
    ? entry.paidNowCents ?? 0
    : Math.round((entry.paidNow ?? 0) * 100);
}

function movementDeltaCents(entry: LedgerEntry): number {
  if (entry.type === 'sale') return entryAmountCents(entry) - paidNowCents(entry);
  if (entry.type === 'debt') return entryAmountCents(entry);
  if (entry.type === 'payment') return -entryAmountCents(entry);
  return 0;
}

function debitCents(entry: LedgerEntry): number {
  return entry.type === 'sale' || entry.type === 'debt' ? entryAmountCents(entry) : 0;
}

function creditCents(entry: LedgerEntry): number {
  if (entry.type === 'payment') return entryAmountCents(entry);
  return entry.type === 'sale' ? paidNowCents(entry) : 0;
}

function signedMoney(cents: number): string {
  return `${cents < 0 ? '−' : ''}${money(Math.abs(cents) / 100)}`;
}

function referenceCode(id: string): string {
  return id.slice(-8).toLocaleUpperCase('tr-TR');
}

function documentLabel(entry: LedgerEntry): string {
  if (entry.type === 'payment') return 'Tahsilat';
  if (entry.type === 'due_update') return 'Vade değişikliği';
  if (isSalesDocument(entry)) return 'Satış';
  return 'Borç kaydı';
}

function VatSummary({ breakdown, compact = false }: { breakdown: VatBreakdown; compact?: boolean }) {
  return <section className={`print-vat-summary ${compact ? 'is-compact' : ''}`} aria-label="KDV özeti">
    <div className="print-vat-heading">KDV ÖZETİ <span>%{breakdown.vatRateBps / 100}</span></div>
    <div className="print-vat-row"><span>Matrah · KDV hariç</span><strong>{money(breakdown.vatBaseCents / 100)}</strong></div>
    <div className="print-vat-row"><span>KDV (%{breakdown.vatRateBps / 100})</span><strong>{money(breakdown.vatCents / 100)}</strong></div>
    <div className="print-vat-row print-vat-gross"><span>Genel toplam · KDV dâhil</span><strong>{money(breakdown.grossCents / 100)}</strong></div>
  </section>;
}

function BrandHeader({ title, reference }: { title: string; reference?: string }) {
  return <header className="print-brand-header">
    <div className="print-brand-lockup">
      <span className="print-brand-mark"><img src="/cari-usta-logo.svg" alt="" /></span>
      <span className="print-brand-copy"><strong>Çalışkanlar Yapı Market</strong><small>Yapı malzemeleri · Cari hesap takibi</small></span>
    </div>
    <div className="print-brand-document">
      <strong>{title}</strong>
      <span>{reference ? `İşlem kodu: ${reference}` : 'Müşteri hesap dökümü'}</span>
    </div>
  </header>;
}

function CustomerCard({ customer, compact = false }: { customer: Customer; compact?: boolean }) {
  return <section className={`print-customer-card ${compact ? 'is-compact' : ''}`}>
    <div className="print-customer-primary"><small>MÜŞTERİ</small><strong>{customer.name}</strong><span>{customer.company || 'Bireysel müşteri'}</span></div>
    <div><small>TELEFON</small><strong>{customer.phone || '—'}</strong></div>
    <div><small>GÜNCEL VADE</small><strong>{customer.currentDueDate ? formatDate(customer.currentDueDate) : '—'}</strong></div>
    <div><small>ÇIKTI TARİHİ</small><strong>{formatDate(todayIso())}</strong></div>
  </section>;
}

function StatementMovementRow({ entry, balanceAfterCents }: PrintRow) {
  const isSale = isSalesDocument(entry);
  const items = entry.items ?? [];
  const vat = saleVatBreakdown(entry);
  return <tr className={`print-ledger-row ${entry.type === 'payment' ? 'is-payment' : ''}`}>
    <td className="print-date-cell">{formatDate(entry.date)}</td>
    <td className="print-description-cell">
      <strong className="print-movement-label">{documentLabel(entry)}</strong>
      {entry.note && <small className="print-movement-note">{entry.note}</small>}
      {entry.type === 'due_update' && <small className="print-movement-note">{entry.previousDueDate ? formatDate(entry.previousDueDate) : 'Vade yok'} → {formatDate(entry.nextDueDate)}</small>}
      {items.length > 0 && <ul className="print-inline-items">{items.map((item, index) => <li key={`${entry.id}-item-${index}`}>
        {item.name} · {formatQuantity(saleItemQuantity(item))} {item.unit} × {money(saleItemUnitPrice(item))} = {money(saleItemLineTotal(item))}
      </li>)}</ul>}
      {isSale && items.length === 0 && <small className="print-movement-note">Ürün ayrıntısı kaydedilmedi</small>}
      {vat && <small className="print-vat-hint">Fiyatlar KDV dâhil · %{vat.vatRateBps / 100}</small>}
    </td>
    <td className="print-money-cell">{debitCents(entry) > 0 ? money(debitCents(entry) / 100) : '—'}</td>
    <td className="print-money-cell">{creditCents(entry) > 0 ? money(creditCents(entry) / 100) : '—'}</td>
    <td className="print-money-cell print-balance-cell">{balanceAfterCents === null ? '—' : signedMoney(balanceAfterCents)}</td>
  </tr>;
}

function StatementDocument({ customer, rows, openingBalanceCents }: {
  customer: Customer;
  rows: PrintRow[];
  openingBalanceCents: number;
}) {
  const periodDebitCents = rows.reduce((sum, row) => sum + debitCents(row.entry), 0);
  const periodCreditCents = rows.reduce((sum, row) => sum + creditCents(row.entry), 0);
  const vatParts = rows.map((row) => saleVatBreakdown(row.entry)).filter((part): part is VatBreakdown => part !== null);
  const vatTotal = vatParts.length ? vatParts.reduce<VatBreakdown>((sum, part) => ({
    grossCents: sum.grossCents + part.grossCents,
    vatBaseCents: sum.vatBaseCents + part.vatBaseCents,
    vatCents: sum.vatCents + part.vatCents,
    vatRateBps: part.vatRateBps,
  }), { grossCents: 0, vatBaseCents: 0, vatCents: 0, vatRateBps: 2_000 }) : null;
  const firstDate = rows[0]?.entry.date;
  const lastDate = rows.at(-1)?.entry.date;
  const rangeLabel = firstDate && lastDate
    ? firstDate === lastDate ? formatDate(firstDate) : `${formatDate(firstDate)} – ${formatDate(lastDate)}`
    : 'Hareket bulunmuyor';

  return <>
    <BrandHeader title="CARİ HESAP EKSTRESİ" />
    <section className="print-document-title">
      <div><small>HESAP HAREKETLERİ</small><h1>{customer.name}</h1><p>{customer.company || 'Bireysel müşteri'} · {rangeLabel}</p></div>
      <div className="print-period-badge"><small>GÜNCEL BAKİYE</small><strong>{money(customer.balance)}</strong></div>
    </section>
    <CustomerCard customer={customer} />
    <section className="print-summary-strip">
      <div><small>AÇILIŞ / DEVİR</small><strong>{signedMoney(openingBalanceCents)}</strong></div>
      <div><small>DÖNEM BORÇ</small><strong>{money(periodDebitCents / 100)}</strong></div>
      <div><small>DÖNEM TAHSİLAT</small><strong>{money(periodCreditCents / 100)}</strong></div>
      <div className="print-summary-balance"><small>GÜNCEL KALAN</small><strong>{money(customer.balance)}</strong></div>
    </section>
    <table className="print-ledger-table">
      <thead><tr><th>Tarih</th><th>Hareket ayrıntısı</th><th className="print-money-cell">Borç</th><th className="print-money-cell">Alacak</th><th className="print-money-cell">Bakiye</th></tr></thead>
      <tbody>
        <tr className="print-opening-row"><td>—</td><td><strong>Açılış / devir bakiyesi</strong><small>Listelenen hareketlerden önce</small></td><td>—</td><td>—</td><td className="print-money-cell">{signedMoney(openingBalanceCents)}</td></tr>
        {rows.map((row) => <StatementMovementRow key={row.entry.id} {...row} />)}
        {!rows.length && <tr><td colSpan={5} className="print-no-movements">Bu müşteri için listelenecek hareket bulunmuyor.</td></tr>}
      </tbody>
      <tfoot><tr><th colSpan={2}>Hareket toplamı</th><th className="print-money-cell">{money(periodDebitCents / 100)}</th><th className="print-money-cell">{money(periodCreditCents / 100)}</th><th className="print-money-cell">{money(customer.balance)}</th></tr></tfoot>
    </table>
    {vatTotal && <VatSummary breakdown={vatTotal} />}
    <div className="print-statement-note">KDV özeti, %20 KDV dâhil olarak kaydedilen veya ürün ayrıntısı bulunan satışları kapsar. Ürün bilgisi olmayan eski borç hareketleri bu özete eklenmez.</div>
    <footer className="print-document-footer">
      <span>Bu çıktı Çalışkanlar Yapı Market iç cari takibi için hazırlanmıştır.</span>
      <strong>Resmî e-Fatura / e-Arşiv belgesi değildir.</strong>
    </footer>
  </>;
}

function orderedStatementEntries(entries: LedgerEntry[]): LedgerEntry[] {
  return entries
    .filter((entry) => entry.type === 'sale' || entry.type === 'debt' || entry.type === 'payment' || entry.type === 'due_update')
    .sort((left, right) => left.date.localeCompare(right.date)
      || entryCreatedAtMillis(left) - entryCreatedAtMillis(right)
      || left.id.localeCompare(right.id));
}

function buildStatementRows(customer: Customer, entries: LedgerEntry[]) {
  const ledgerDeltaCents = entries.reduce((total, entry) => total + movementDeltaCents(entry), 0);
  const openingBalanceCents = Math.round(customer.balance * 100) - ledgerDeltaCents;
  const rows = entries.reduce<PrintRow[]>((result, entry) => {
    const previous = result.at(-1)?.balanceAfterCents ?? openingBalanceCents;
    result.push({ entry, balanceAfterCents: previous + movementDeltaCents(entry) });
    return result;
  }, []);
  return { rows, openingBalanceCents };
}

/** Returns the same A4 statement markup used by the print view, for local PDF rendering. */
export async function renderCustomerStatementMarkup(customer: Customer, entries: LedgerEntry[]): Promise<string> {
  const { rows, openingBalanceCents } = buildStatementRows(customer, orderedStatementEntries(entries));
  const { renderToStaticMarkup } = await import('react-dom/server');
  return renderToStaticMarkup(<article className="customer-print-sheet" data-print-mode="statement">
    <StatementDocument customer={customer} rows={rows} openingBalanceCents={openingBalanceCents} />
  </article>);
}

function SaleReceiptDocument({ customer, entry, balanceAfterCents, isCashSale = false, reference }: {
  customer: Customer;
  entry: LedgerEntry;
  balanceAfterCents: number | null;
  isCashSale?: boolean;
  reference?: string;
}) {
  const vat = saleVatBreakdown(entry);
  const grossCents = entryAmountCents(entry);
  const paidCents = isCashSale ? grossCents : entry.type === 'sale' ? paidNowCents(entry) : 0;
  const remainingCents = Number.isSafeInteger(entry.remainingCents)
    ? entry.remainingCents ?? 0
    : Number.isSafeInteger(entry.remainingAtSale)
      ? Math.round((entry.remainingAtSale ?? 0) * 100)
      : entry.type === 'sale' ? Math.max(0, grossCents - paidCents) : grossCents;
  const items = entry.items ?? [];
  const documentTitle = isCashSale ? 'PEŞİN SATIŞ FİŞİ' : 'MÜŞTERİ SATIŞ FİŞİ';

  return <>
    <BrandHeader title={documentTitle} reference={reference ?? referenceCode(entry.id)} />
    <section className="print-receipt-heading"><small>{isCashSale ? 'PEŞİN SATIŞ' : 'SATIŞ KAYDI'}</small><h1>{isCashSale ? 'Peşin satış fişi' : 'Satış fişi'}</h1><p>{formatDate(entry.date)}{entry.nextDueDate ? ` · Vade ${formatDate(entry.nextDueDate)}` : ''}</p></section>
    <CustomerCard customer={customer} compact />
    <table className="print-receipt-items">
      <thead><tr><th>Ürün / miktar</th><th>KDV</th><th className="print-money-cell">Tutar</th></tr></thead>
      <tbody>
        {items.map((item, index) => <tr key={`${entry.id}-receipt-${index}`}>
          <td><strong>{item.name}</strong><small>{formatQuantity(saleItemQuantity(item))} {item.unit} × {money(saleItemUnitPrice(item))} <span>(KDV dâhil)</span></small></td>
          <td>{vat ? `%${vat.vatRateBps / 100}` : '—'}</td>
          <td className="print-money-cell">{money(saleItemLineTotal(item))}</td>
        </tr>)}
        {!items.length && <tr><td><strong>Satış tutarı</strong><small>Ürün ayrıntısı kaydedilmedi</small></td><td>{vat ? `%${vat.vatRateBps / 100}` : '—'}</td><td className="print-money-cell">{money(grossCents / 100)}</td></tr>}
      </tbody>
    </table>
    {vat ? <VatSummary breakdown={vat} compact /> : <div className="print-vat-unavailable">Bu eski kayıt için KDV ayrıştırma bilgisi bulunmuyor.</div>}
    <section className="print-receipt-facts">
      <div><span>Satış biçimi</span><strong>{isCashSale ? 'Peşin satış' : entry.type === 'sale' ? (paidCents <= 0 ? 'Veresiye' : remainingCents <= 0 ? 'Peşin' : 'Kısmi ödeme') : 'Cari satış'}</strong></div>
      {(isCashSale || entry.type === 'sale') && <div><span>{isCashSale ? 'Tahsilat yöntemi' : 'Satışta tahsil edilen'}</span><strong>{money(paidCents / 100)}{entry.paymentMethod ? ` · ${paymentMethodLabel(entry.paymentMethod)}` : ''}</strong></div>}
      {!isCashSale && <div><span>Cari borca eklenen</span><strong>{money(remainingCents / 100)}</strong></div>}
      {balanceAfterCents !== null && <div><span>İşlem sonrası bakiye</span><strong>{money(balanceAfterCents / 100)}</strong></div>}
      {entry.note && <div><span>Not</span><strong>{entry.note}</strong></div>}
    </section>
    <section className="print-signatures"><div>Satışı hazırlayan</div><div>Müşteri / teslim alan</div></section>
    <footer className="print-document-footer print-receipt-footer">
      <span>{isCashSale ? 'Peşin satış, stok ve ayrı satış belgesi olarak kaydedilmiştir; cari hesap bakiyesi değişmemiştir.' : 'Fiyatlar %20 KDV dâhildir; KDV tutarı brüt toplamın içinden ayrıştırılır.'}</span>
      <strong>{isCashSale ? 'İç kullanım satış belgesidir; resmî e-Fatura / e-Arşiv değildir.' : 'Cari bilgilendirme çıktısıdır; resmî e-Fatura / e-Arşiv değildir.'}</strong>
    </footer>
  </>;
}

export default function CustomerPrint({ customer, entries, mode, onDone }: CustomerPrintProps) {
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; }, [onDone]);

  const saleId = mode.kind === 'sale' ? mode.saleId : '';
  const printableEntries = entries
    .filter((entry) => mode.kind === 'statement'
      ? entry.type === 'sale' || entry.type === 'debt' || entry.type === 'payment' || entry.type === 'due_update'
      : isSalesDocument(entry))
    .filter((entry) => mode.kind === 'statement' || entry.id === saleId)
    .sort((left, right) => left.date.localeCompare(right.date)
      || entryCreatedAtMillis(left) - entryCreatedAtMillis(right)
      || left.id.localeCompare(right.id));
  const statement = mode.kind === 'statement' ? buildStatementRows(customer, printableEntries) : null;
  const openingBalanceCents = statement?.openingBalanceCents ?? 0;
  const rows: PrintRow[] = statement?.rows ?? printableEntries.map((entry) => ({ entry, balanceAfterCents: null }));
  const saleRow = rows[0];

  useEffect(() => {
    const finish = () => doneRef.current();
    window.addEventListener('afterprint', finish);
    const timer = window.setTimeout(() => window.print(), 180);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', finish);
    };
  }, [mode.kind, saleId]);

  return createPortal(<article className="customer-print-sheet" data-print-mode={mode.kind} aria-hidden="true">
    {mode.kind === 'statement'
      ? <StatementDocument customer={customer} rows={rows} openingBalanceCents={openingBalanceCents} />
      : saleRow
        ? <SaleReceiptDocument customer={customer} entry={saleRow.entry} balanceAfterCents={saleRow.balanceAfterCents} />
        : <div className="print-empty">Yazdırılacak satış kaydı bulunamadı.</div>}
  </article>, document.body);
}

export function CashSalePrint({ sale, onDone }: { sale: CashSale; onDone: () => void }) {
  const doneRef = useRef(onDone);
  useEffect(() => { doneRef.current = onDone; }, [onDone]);
  useEffect(() => {
    const finish = () => doneRef.current();
    window.addEventListener('afterprint', finish);
    const timer = window.setTimeout(() => window.print(), 180);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('afterprint', finish);
    };
  }, [sale.id]);

  const customer: Customer = {
    id: sale.customerId ?? `cash-${sale.id}`,
    name: sale.customerName || 'Peşin müşteri',
    phone: sale.customerPhone ?? '',
    company: sale.customerCompany ?? '',
    note: '',
    currentDueDate: '',
    totalDebt: 0,
    totalPaid: 0,
    balance: 0,
  };
  const entry: LedgerEntry = {
    id: sale.id,
    type: 'sale',
    amount: sale.amountCents / 100,
    amountCents: sale.amountCents,
    date: sale.date,
    note: sale.note,
    customerId: customer.id,
    customerName: customer.name,
    items: sale.items,
    vatRateBps: sale.vatRateBps,
    vatBaseCents: sale.vatBaseCents,
    vatCents: sale.vatCents,
    paidNowCents: sale.amountCents,
    remainingCents: 0,
    paymentMethod: sale.paymentMethod,
  };

  return createPortal(<article className="customer-print-sheet" data-print-mode="sale" aria-hidden="true">
    <SaleReceiptDocument customer={customer} entry={entry} balanceAfterCents={null} isCashSale reference={sale.invoiceNumber} />
  </article>, document.body);
}
