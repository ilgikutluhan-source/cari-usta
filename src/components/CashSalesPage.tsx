import { useMemo, useState, type FormEvent } from 'react';
import { Banknote, Check, FileText, Printer, Search, ShoppingCart, Trash2 } from 'lucide-react';
import type { CashSale, CashSaleCreateInput, Customer, InventoryProduct, SalePaymentMethod } from '../models';
import { formatDate, formatQuantity, money, parseQuantityMilli, paymentMethodLabel, splitVatInclusiveCents, todayIso } from '../models';
import { buildCashSaleLines, type CashSaleDraftRow } from '../cash-sales-validation';
import { CashSalePrint } from './CustomerPrint';

type CashSalesPageProps = {
  products: InventoryProduct[];
  customers: Customer[];
  sales: CashSale[];
  onCreate: (input: CashSaleCreateInput) => Promise<CashSale>;
};

const makeRow = (productId: string): CashSaleDraftRow => ({ id: crypto.randomUUID(), productId, quantity: '1' });

function invoiceSearchText(sale: CashSale) {
  return `${sale.invoiceNumber} ${sale.customerName ?? ''} ${sale.note} ${sale.items.map((item) => item.name).join(' ')}`.toLocaleLowerCase('tr-TR');
}

export function CashSalesPage({ products, customers, sales, onCreate }: CashSalesPageProps) {
  const [rows, setRows] = useState<CashSaleDraftRow[]>([]);
  const [date, setDate] = useState(todayIso());
  const [draftSaleId, setDraftSaleId] = useState(() => crypto.randomUUID());
  const [paymentMethod, setPaymentMethod] = useState<SalePaymentMethod>('cash');
  const [customerId, setCustomerId] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [savedSale, setSavedSale] = useState<CashSale | null>(null);
  const [printing, setPrinting] = useState<CashSale | null>(null);
  const [historySearch, setHistorySearch] = useState('');
  const activeProducts = useMemo(() => products.filter((product) => product.active), [products]);
  const calculated = useMemo(() => buildCashSaleLines(rows, products), [rows, products]);
  const totalCents = calculated.ok ? calculated.amountCents : 0;
  const vat = splitVatInclusiveCents(totalCents);
  const visibleSales = useMemo(() => {
    const query = historySearch.trim().toLocaleLowerCase('tr-TR');
    return [...sales]
      .filter((sale) => !query || invoiceSearchText(sale).includes(query))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      .slice(0, 100);
  }, [sales, historySearch]);

  function addProduct(productId: string) {
    if (!productId) return;
    if (rows.length >= 25) { setError('Bir peşin satışta en fazla 25 ürün satırı eklenebilir.'); return; }
    const product = activeProducts.find((item) => item.id === productId);
    if (!product || product.stockQuantityMilli <= 0) { setError('Seçilen ürünün kullanılabilir stoğu yok.'); return; }
    setRows((current) => [...current, makeRow(product.id)]);
    setSavedSale(null);
    setError('');
  }

  function updateRow(id: string, quantity: string) {
    setRows((current) => current.map((row) => row.id === id ? { ...row, quantity } : row));
    setSavedSale(null);
    if (error) setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    if (!calculated.ok) { setError(calculated.error); return; }
    if (!date) { setError('Satış tarihini seçin.'); return; }
    const customer = customers.find((item) => item.id === customerId);
    if (customerId && (!customer || customer.archivedAt)) { setError('Seçilen müşteri artık aktif değil. Listeyi yenileyip tekrar deneyin.'); return; }
    setBusy(true);
    try {
      const saved = await onCreate({
        saleId: draftSaleId,
        date,
        note: note.trim(),
        paymentMethod,
        amountCents: calculated.amountCents,
        items: calculated.items,
        ...(customerId ? { customerId } : {}),
      });
      setSavedSale(saved);
      setDraftSaleId(crypto.randomUUID());
      setRows([]);
      setCustomerId('');
      setPaymentMethod('cash');
      setNote('');
      setDate(todayIso());
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Peşin satış kaydedilemedi. Stok değişmedi.');
    } finally {
      setBusy(false);
    }
  }

  return <div className="cash-sales-page">
    <section className="cash-sale-intro panel">
      <span className="cash-sale-intro-icon"><Banknote size={19} /></span>
      <div><strong>Peşin satış · ayrı kayıt</strong><p>Stoktan seçilen ürünlerin miktarı satışla birlikte düşer; bu işlem müşterinin cari bakiyesine borç eklemez.</p></div>
      <span className="cash-sale-vat-badge">KDV dâhil · %20</span>
    </section>

    <div className="cash-sale-layout">
      <form id="cash-sale-form" className="panel cash-sale-form" onSubmit={(event) => void submit(event)}>
        <div className="cash-sale-panel-heading">
          <div><span className="cash-sale-kicker">HIZLI KASA</span><h2>Yeni peşin satış</h2><p>Ürünü seçin, miktarı girin ve ödemeyi kaydedin.</p></div>
          <span className="cash-sale-panel-icon"><ShoppingCart size={18} /></span>
        </div>

        <div className="cash-sale-product-picker">
          <label className="field"><span>Stoktan ürün seçip ekle</span>
            <select aria-label="Stok kataloğundan ürün ekle" value="" onChange={(event) => addProduct(event.target.value)} disabled={!activeProducts.length || rows.length >= 25}>
              <option value="">Katalogdan ürün ekleyin…</option>
              {activeProducts.map((product) => <option key={product.id} value={product.id} disabled={product.stockQuantityMilli <= 0}>
                {product.name} · {money(product.salePriceCents / 100)} · stok {formatQuantity(product.stockQuantityMilli / 1000)} {product.unit}{product.stockQuantityMilli <= 0 ? ' · Tükendi' : ''}
              </option>)}
            </select>
            <small>{activeProducts.length ? 'Seçilen ürün sepete 1 birim olarak eklenir; aynı ürünü tekrar seçerek miktar satırı ekleyebilirsiniz.' : 'Önce Stok sekmesinden aktif ürün ve başlangıç stoğu ekleyin.'}</small>
          </label>
        </div>

        {!rows.length ? <div className="cash-sale-empty-cart"><span><ShoppingCart size={19} /></span><strong>Sepet boş</strong><small>Satışa başlamak için stok kataloğundan ürün seçin.</small></div> : <div className="cash-sale-cart" aria-label="Peşin satış ürün sepeti">
          {rows.map((row, index) => {
            const product = activeProducts.find((item) => item.id === row.productId);
            const quantityMilli = product ? parseQuantityMilli(row.quantity) : null;
            const lineCents = calculated.ok ? calculated.items[index]?.lineTotalCents : null;
            return <article className="cash-sale-cart-row" key={row.id}>
              <div className="cash-sale-cart-product"><span className="cash-sale-line-index">{String(index + 1).padStart(2, '0')}</span><div><strong>{product?.name ?? 'Ürün kullanılamıyor'}</strong><small>{product ? `${money(product.salePriceCents / 100)} / ${product.unit} · stok ${formatQuantity(product.stockQuantityMilli / 1000)} ${product.unit}` : 'Ürünü yenileyip tekrar seçin.'}</small></div></div>
              <label className="cash-sale-quantity"><span>Miktar · {product?.unit ?? 'birim'}</span><input aria-label={`${product?.name ?? 'Ürün'} miktarı`} inputMode="decimal" value={row.quantity} onChange={(event) => updateRow(row.id, event.target.value)} maxLength={16} /></label>
              <div className="cash-sale-line-total"><span>Satır toplamı</span><strong>{lineCents === null ? '—' : money(lineCents / 100)}</strong></div>
              <button type="button" className="cash-sale-remove" onClick={() => { setRows((current) => current.filter((item) => item.id !== row.id)); setSavedSale(null); setError(''); }} aria-label={`${product?.name ?? 'Ürün'} satırını kaldır`} title="Satırı kaldır"><Trash2 size={15} /></button>
              {product && quantityMilli !== null && quantityMilli > product.stockQuantityMilli && <small className="cash-sale-stock-error">Stok yetersiz · en fazla {formatQuantity(product.stockQuantityMilli / 1000)} {product.unit}</small>}
            </article>;
          })}
        </div>}
        {!calculated.ok && rows.length > 0 && <div className="form-error" role="alert">{calculated.error}</div>}

        <div className="cash-sale-form-grid">
          <label className="field"><span>Ödeme yöntemi <i>*</i></span><select value={paymentMethod} onChange={(event) => { setPaymentMethod(event.target.value as SalePaymentMethod); setSavedSale(null); }} required>
            <option value="cash">Nakit</option><option value="pos">Kart / POS</option><option value="transfer">Havale / EFT</option><option value="other">Diğer</option>
          </select></label>
          <label className="field"><span>Satış tarihi <i>*</i></span><input type="date" value={date} onChange={(event) => { setDate(event.target.value); setSavedSale(null); }} required /></label>
        </div>
        <label className="field"><span>Müşteri <small>İsteğe bağlı · yalnızca satış belgesinde görünür</small></span><select value={customerId} onChange={(event) => { setCustomerId(event.target.value); setSavedSale(null); }}>
          <option value="">Peşin müşteri / müşteri seçilmedi</option>{customers.filter((item) => !item.archivedAt).map((customer) => <option key={customer.id} value={customer.id}>{customer.name} · cari {money(customer.balance)}</option>)}
        </select><small>Bu seçim cari bakiyeyi, borç ve tahsilat toplamlarını değiştirmez.</small></label>
        <label className="field"><span>Açıklama</span><input value={note} onChange={(event) => { setNote(event.target.value); setSavedSale(null); }} maxLength={180} placeholder="Örn. Mağaza içi satış" /></label>
        {error && <div className="form-error" role="alert">{error}</div>}

        {savedSale && <div className="cash-sale-success" role="status"><span><Check size={15} /></span><div><strong>Satış kaydedildi · {savedSale.invoiceNumber}</strong><small>Stok güncellendi; cari hesap değişmedi.</small></div><button type="button" className="button button-outline" onClick={() => setPrinting(savedSale)}><Printer size={14} /> Fişi yazdır</button></div>}
      </form>

      <aside className="panel cash-sale-summary">
        <div className="cash-sale-summary-heading"><span>TAHSİLAT ÖZETİ</span><span className="cash-sale-summary-dot" /></div>
        <div className="cash-sale-grand-total"><small>Satış toplamı · KDV dâhil</small><strong>{money(totalCents / 100)}</strong><span>{rows.length} ürün satırı · {paymentMethodLabel(paymentMethod)}</span></div>
        <div className="cash-sale-vat-lines">
          <div><span>Matrah · KDV hariç</span><strong>{money((vat?.vatBaseCents ?? 0) / 100)}</strong></div>
          <div><span>KDV (%20)</span><strong>{money((vat?.vatCents ?? 0) / 100)}</strong></div>
          <div className="cash-sale-vat-total"><span>Ödenecek toplam</span><strong>{money(totalCents / 100)}</strong></div>
        </div>
        <div className="cash-sale-summary-callout"><FileText size={15} /><span>Satış ayrı peşin satış belgesi olarak saklanır. Cari hesaba borç yazılmaz.</span></div>
        <button type="submit" form="cash-sale-form" className="button button-primary cash-sale-submit" disabled={!calculated.ok || busy}>
          {busy ? 'Kaydediliyor…' : <><Check size={16} /> Peşin satışı kaydet</>}
        </button>
        <small className="cash-sale-legal-note">Yazdırılabilir iç satış belgesidir; resmî e-Fatura / e-Arşiv değildir.</small>
      </aside>
    </div>

    <section className="panel cash-sale-history-panel">
      <div className="cash-sale-panel-heading history-heading"><div><span className="cash-sale-kicker">SATIŞ ARŞİVİ</span><h2>Son peşin satışlar <span className="count-pill">{visibleSales.length}</span></h2><p>Son 100 belge · diğer yetkili cihazlarda gerçek zamanlı güncellenir.</p></div>
        <label className="cash-sale-history-search"><Search size={15} /><span className="sr-only">Peşin satışlarda ara</span><input value={historySearch} onChange={(event) => setHistorySearch(event.target.value)} placeholder="Belge no, müşteri veya ürün" /></label>
      </div>
      {!visibleSales.length ? <div className="cash-sale-history-empty"><span><FileText size={18} /></span><strong>{sales.length ? 'Eşleşen satış yok' : 'Henüz peşin satış kaydı yok'}</strong><small>{sales.length ? 'Belge numarası, müşteri veya ürün adını kontrol edin.' : 'İlk peşin satış kaydedildiğinde burada görünecek.'}</small></div> : <div className="cash-sale-history-list">
        {visibleSales.map((sale) => <article className="cash-sale-history-row" key={sale.id}>
          <span className="cash-sale-history-icon"><FileText size={16} /></span>
          <span className="cash-sale-history-main"><strong>{sale.invoiceNumber}</strong><small>{formatDate(sale.date)} · {sale.customerName || 'Peşin müşteri'} · {sale.items.length} kalem</small></span>
          <span className="cash-sale-history-method">{paymentMethodLabel(sale.paymentMethod)}</span>
          <strong className="cash-sale-history-total">{money(sale.amountCents / 100)}</strong>
          <button type="button" className="button button-outline cash-sale-print-button" onClick={() => setPrinting(sale)}><Printer size={14} /> Fiş</button>
        </article>)}
      </div>}
    </section>

    {printing && <CashSalePrint sale={printing} onDone={() => setPrinting(null)} />}
  </div>;
}
