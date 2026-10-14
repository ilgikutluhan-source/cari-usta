import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { AlertCircle, Archive, ArrowDownLeft, ArrowUpRight, Check, ChevronDown, Pencil, Plus, RotateCcw, Search, X } from 'lucide-react';
import type { InventoryProduct, StockMovement, StockMovementType } from '../models';
import { formatDate, formatMoneyInput, money, todayIso } from '../models';
import { parseInventoryProductForm, parseNonNegativeQuantityMilli, type InventoryProductFormValues, type InventoryProductInput } from '../inventory-validation';

type InventoryPageProps = {
  products: InventoryProduct[];
  movements: StockMovement[];
  search: string;
  onSearchChange: (value: string) => void;
  onCreate: (data: InventoryProductInput) => Promise<void>;
  onUpdate: (productId: string, data: InventoryProductInput) => Promise<void>;
  onSetActive: (productId: string, active: boolean) => Promise<void>;
  onAdjust: (product: InventoryProduct, deltaMilli: number, type: Extract<StockMovementType, 'receipt' | 'adjustment'>, date: string, note: string) => Promise<void>;
};

const quantityText = (quantityMilli: number) => (quantityMilli / 1000).toLocaleString('tr-TR', { maximumFractionDigits: 3 });
const centsText = (cents: number) => (cents / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const local = (value: string) => value.toLocaleLowerCase('tr-TR');

function stockStatus(product: InventoryProduct) {
  if (product.stockQuantityMilli <= 0) return { className: 'empty', label: 'Tükendi' };
  if (product.stockQuantityMilli <= product.lowStockThresholdMilli) return { className: 'low', label: 'Az stok' };
  return { className: 'available', label: 'Stokta' };
}

export function InventoryPage({ products, movements, search, onSearchChange, onCreate, onUpdate, onSetActive, onAdjust }: InventoryPageProps) {
  const [showArchived, setShowArchived] = useState(false);
  const [modal, setModal] = useState<{ type: 'product'; product?: InventoryProduct } | { type: 'stock'; product: InventoryProduct; mode: 'receipt' | 'adjustment' } | null>(null);
  const activeProducts = products.filter((product) => product.active);
  const lowProducts = activeProducts.filter((product) => product.stockQuantityMilli <= product.lowStockThresholdMilli && product.stockQuantityMilli > 0).length;
  const emptyProducts = activeProducts.filter((product) => product.stockQuantityMilli <= 0).length;
  const visibleProducts = useMemo(() => products
    .filter((product) => showArchived ? !product.active : product.active)
    .filter((product) => !search.trim() || local(`${product.name} ${product.sku} ${product.unit}`).includes(local(search.trim())))
    .sort((a, b) => a.name.localeCompare(b.name, 'tr-TR')), [products, search, showArchived]);

  async function saveProduct(productId: string | null, data: InventoryProductInput) {
    if (productId) await onUpdate(productId, data);
    else await onCreate(data);
    setModal(null);
  }

  async function setProductActive(product: InventoryProduct) {
    const active = !product.active;
    if (!window.confirm(active
      ? `${product.name} ürünü satış listesine geri yüklensin mi?`
      : `${product.name} ürünü arşivlensin mi? Geçmiş satış ve stok hareketleri korunur.`)) return;
    try {
      await onSetActive(product.id, active);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Ürün durumu güncellenemedi.');
    }
  }

  return <div className="inventory-page">
    <section className="inventory-summary-grid" aria-label="Stok özeti">
      <SummaryCard label="AKTİF ÜRÜN" value={String(activeProducts.length)} detail="Satışta seçilebilir" tone="neutral" />
      <SummaryCard label="DÜŞÜK STOK" value={String(lowProducts)} detail="Eşik miktarına ulaştı" tone="warning" />
      <SummaryCard label="TÜKENEN" value={String(emptyProducts)} detail="Stok girişi bekliyor" tone="danger" />
    </section>

    <div className="inventory-body-grid">
      <section className="panel inventory-product-panel">
        <div className="panel-heading inventory-heading">
          <div><h2>Ürün kataloğu <span className="count-pill">{visibleProducts.length}</span></h2><p>Stoktan ürün seçilen satışlarda miktar otomatik düşer.</p></div>
          <button type="button" className="button button-primary" onClick={() => setModal({ type: 'product' })}><Plus size={15} /> Yeni ürün</button>
        </div>
        <div className="inventory-toolbar">
          <label className="inventory-search"><Search size={15} /><span className="sr-only">Ürünlerde ara</span><input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder="Ürün adı, stok kodu veya birim" /></label>
          <label className="filter-control"><Archive size={14} /><select aria-label="Ürün görünümü" value={showArchived ? 'archived' : 'active'} onChange={(event) => setShowArchived(event.target.value === 'archived')}><option value="active">Aktif ürünler</option><option value="archived">Arşivlenenler</option></select><ChevronDown size={14} /></label>
        </div>
        {!visibleProducts.length ? <div className="empty-state inventory-empty"><div className="empty-icon"><Archive size={20} /></div><strong>{search.trim() ? 'Eşleşen ürün bulunamadı' : showArchived ? 'Arşivlenmiş ürün yok' : 'Henüz stok ürünü yok'}</strong><span>{search.trim() ? 'Ürün adı veya stok kodunu kontrol edin.' : showArchived ? 'Arşivlediğiniz ürünler geçmişleriyle burada saklanır.' : 'Kataloğa ürün ekleyin; satış sırasında buradan seçebilirsiniz.'}</span></div> : <div className="table-scroll inventory-table-scroll"><table className="inventory-table"><thead><tr><th>ÜRÜN / KOD</th><th>BİRİM FİYATI<br />(KDV DÂHİL)</th><th>MEVCUT STOK</th><th>DURUM</th><th><span className="sr-only">İşlemler</span></th></tr></thead><tbody>{visibleProducts.map((product) => {
          const status = stockStatus(product);
          return <tr key={product.id}>
            <td><span className="inventory-product-name"><strong>{product.name}</strong><small>{product.sku || 'Stok kodu yok'}</small></span></td>
            <td className="inventory-price">{money(product.salePriceCents / 100)}</td>
            <td><strong className="inventory-quantity">{quantityText(product.stockQuantityMilli)} <small>{product.unit}</small></strong><span className="inventory-threshold">Eşik: {quantityText(product.lowStockThresholdMilli)} {product.unit}</span></td>
            <td><span className={`inventory-status ${product.active ? status.className : 'archived'}`}>{product.active ? status.label : 'Arşivde'}</span></td>
            <td><div className="inventory-actions">
              {product.active && <><button type="button" className="inventory-action-button" onClick={() => setModal({ type: 'stock', product, mode: 'receipt' })} aria-label={`${product.name} için stok girişi`} title="Stok ekle"><ArrowDownLeft size={15} /></button><button type="button" className="inventory-action-button" onClick={() => setModal({ type: 'stock', product, mode: 'adjustment' })} aria-label={`${product.name} için stok sayımı düzelt`} title="Sayım düzelt"><ArrowUpRight size={15} /></button></>}
              <button type="button" className="inventory-action-button" onClick={() => setModal({ type: 'product', product })} aria-label={`${product.name} ürününü düzenle`} title="Ürünü düzenle"><Pencil size={14} /></button>
              <button type="button" className="inventory-action-button" onClick={() => void setProductActive(product)} aria-label={product.active ? `${product.name} ürününü arşivle` : `${product.name} ürününü geri yükle`} title={product.active ? 'Arşivle' : 'Geri yükle'}>{product.active ? <Archive size={14} /> : <RotateCcw size={14} />}</button>
            </div></td>
          </tr>;
        })}</tbody></table></div>}
      </section>

      <section className="panel inventory-activity-panel">
        <div className="panel-heading"><div><h2>Son stok hareketleri</h2><p>En yeni 20 ürün giriş, düzeltme ve satış hareketi.</p></div><span className="inventory-history-mark"><Archive size={17} /></span></div>
        {!movements.length ? <div className="empty-state inventory-empty"><div className="empty-icon"><ArrowDownLeft size={20} /></div><strong>Henüz stok hareketi yok</strong><span>Başlangıç stoğu veya yeni giriş yapıldığında burada görünür.</span></div> : <div className="inventory-history">{movements.slice(0, 20).map((movement) => {
          const ids = Object.keys(movement.productDeltas ?? {});
          const names = ids.map((id) => movement.productNames?.[id] || products.find((product) => product.id === id)?.name || 'Ürün');
          const singleDelta = ids.length === 1 ? movement.productDeltas[ids[0]] : null;
          const detail = movement.type === 'sale' ? `Satış${movement.customerName ? ` · ${movement.customerName}` : ''}` : movement.type === 'opening' ? 'Açılış stoğu' : movement.type === 'receipt' ? 'Stok girişi' : 'Sayım düzeltmesi';
          return <article className="inventory-history-row" key={movement.id}>
            <span className={`inventory-history-icon ${movement.type}`} aria-hidden="true">{movement.type === 'sale' ? <ArrowUpRight size={15} /> : <ArrowDownLeft size={15} />}</span>
            <span className="inventory-history-copy"><strong>{names.length > 1 ? `${names.length} ürün` : names[0] ?? 'Stok hareketi'}</strong><small>{detail} · {formatDate(movement.date)}</small>{movement.note && movement.type !== 'opening' && <small>{movement.note}</small>}</span>
            <span className={`inventory-history-amount ${singleDelta !== null && singleDelta < 0 ? 'negative' : 'positive'}`}>{singleDelta === null ? `${names.length} ürün` : `${singleDelta > 0 ? '+' : '−'}${quantityText(Math.abs(singleDelta))} ${products.find((product) => product.id === ids[0])?.unit ?? ''}`}</span>
          </article>;
        })}</div>}
      </section>
    </div>

    {modal?.type === 'product' && <ProductDialog product={modal.product} onClose={() => setModal(null)} onSubmit={(data) => saveProduct(modal.product?.id ?? null, data)} />}
    {modal?.type === 'stock' && <StockDialog product={modal.product} mode={modal.mode} onClose={() => setModal(null)} onSubmit={async (deltaMilli, type, date, note) => { await onAdjust(modal.product, deltaMilli, type, date, note); setModal(null); }} />}
  </div>;
}

function SummaryCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  return <article className={`inventory-summary-card ${tone}`}><span>{label}</span><strong>{value}</strong><small>{detail}</small></article>;
}

function ProductDialog({ product, onClose, onSubmit }: { product?: InventoryProduct; onClose: () => void; onSubmit: (data: InventoryProductInput) => Promise<void> }) {
  const [values, setValues] = useState<InventoryProductFormValues>({
    name: product?.name ?? '',
    sku: product?.sku ?? '',
    unit: product?.unit ?? 'adet',
    salePrice: product ? centsText(product.salePriceCents) : '',
    openingStock: product ? '0' : '0',
    lowStockThreshold: product ? quantityText(product.lowStockThresholdMilli) : '5',
  });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  function change<K extends keyof InventoryProductFormValues>(key: K, value: InventoryProductFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const normalized = parseInventoryProductForm(values);
    if (!normalized.ok) { setError(normalized.error); return; }
    setBusy(true);
    try { await onSubmit(normalized.value); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Ürün kaydedilemedi.'); }
    finally { setBusy(false); }
  }
  return <ModalShell title={product ? 'Ürünü düzenle' : 'Yeni stok ürünü'} subtitle={product ? 'Ürün tanımı ve satış fiyatını güncelleyin.' : 'Ürün bilgilerini ve başlangıç miktarını girin.'} onClose={onClose}>
    <form className="form-body inventory-form" onSubmit={(event) => void submit(event)}>
      <label className="field"><span>Ürün adı</span><input value={values.name} onChange={(event) => change('name', event.target.value)} maxLength={120} autoFocus required placeholder="Örn. Seramik yapıştırıcısı" /></label>
      <div className="field-row"><label className="field"><span>Stok kodu <small>İsteğe bağlı</small></span><input value={values.sku} onChange={(event) => change('sku', event.target.value)} maxLength={60} placeholder="Örn. YAPI-001" /></label><label className="field"><span>Birim</span><input value={values.unit} onChange={(event) => change('unit', event.target.value)} maxLength={24} required placeholder="adet, kg, m²…" /></label></div>
      <div className="field-row"><label className="field"><span>KDV dâhil satış fiyatı</span><div className="money-input"><input inputMode="decimal" value={values.salePrice} onChange={(event) => change('salePrice', formatMoneyInput(event.target.value))} required placeholder="0,00" /><span>₺</span></div></label><label className="field"><span>Düşük stok eşiği</span><div className="money-input inventory-quantity-input"><input inputMode="decimal" value={values.lowStockThreshold} onChange={(event) => change('lowStockThreshold', event.target.value)} required placeholder="5" /><span>{values.unit || 'birim'}</span></div></label></div>
      {product ? <div className="inventory-opening-note"><AlertCircle size={15} /><span>Mevcut stok: <strong>{quantityText(product.stockQuantityMilli)} {product.unit}</strong>. Miktarı değiştirmek için “Stok ekle” veya “Sayım düzelt” işlemini kullanın.</span></div> : <label className="field"><span>Başlangıç stoğu</span><div className="money-input inventory-quantity-input"><input inputMode="decimal" value={values.openingStock} onChange={(event) => change('openingStock', event.target.value)} required placeholder="0" /><span>{values.unit || 'birim'}</span></div><small className="field-hint">Ürün kaydıyla birlikte açılış stok hareketi oluşturulur.</small></label>}
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="form-actions"><button type="button" className="button button-outline" onClick={onClose}>Vazgeç</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Kaydediliyor…' : <><Check size={15} />{product ? 'Değişiklikleri kaydet' : 'Ürünü ekle'}</>}</button></div>
    </form>
  </ModalShell>;
}

function StockDialog({ product, mode, onClose, onSubmit }: { product: InventoryProduct; mode: 'receipt' | 'adjustment'; onClose: () => void; onSubmit: (deltaMilli: number, type: 'receipt' | 'adjustment', date: string, note: string) => Promise<void> }) {
  const [quantity, setQuantity] = useState(mode === 'adjustment' ? quantityText(product.stockQuantityMilli) : '');
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState(mode === 'receipt' ? 'Yeni stok girişi' : 'Sayım düzeltmesi');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const parsedMilli = parseNonNegativeQuantityMilli(quantity);
    if (parsedMilli === null) { setError('Miktar sıfır veya daha büyük olmalı ve en fazla 3 ondalık hane içermelidir.'); return; }
    const deltaMilli = mode === 'receipt' ? parsedMilli : parsedMilli - product.stockQuantityMilli;
    if (!deltaMilli) { setError('Sayım miktarı mevcut stokla aynı; kaydedilecek değişiklik yok.'); return; }
    if (mode === 'receipt' && deltaMilli < 0) { setError('Stok giriş miktarı sıfırdan büyük olmalıdır.'); return; }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { setError('Geçerli bir hareket tarihi seçin.'); return; }
    if (note.trim().length > 180) { setError('Açıklama en fazla 180 karakter olabilir.'); return; }
    setBusy(true);
    try { await onSubmit(deltaMilli, mode, date, note.trim()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Stok hareketi kaydedilemedi.'); }
    finally { setBusy(false); }
  }
  return <ModalShell title={mode === 'receipt' ? 'Stok girişi ekle' : 'Sayım miktarını düzelt'} subtitle={`${product.name} · mevcut stok ${quantityText(product.stockQuantityMilli)} ${product.unit}`} onClose={onClose}>
    <form className="form-body inventory-form" onSubmit={(event) => void submit(event)}>
      <label className="field"><span>{mode === 'receipt' ? 'Eklenecek miktar' : 'Sayımda bulunan yeni miktar'}</span><div className="money-input inventory-quantity-input"><input inputMode="decimal" value={quantity} onChange={(event) => setQuantity(event.target.value)} required autoFocus placeholder="0" /><span>{product.unit}</span></div>{mode === 'adjustment' && <small className="field-hint">Stok farkı otomatik hesaplanır; miktar eksiye düşürülemez.</small>}</label>
      <div className="field-row"><label className="field"><span>Hareket tarihi</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label><label className="field"><span>Açıklama <small>İsteğe bağlı</small></span><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={180} /></label></div>
      {error && <div className="form-error" role="alert">{error}</div>}
      <div className="form-actions"><button type="button" className="button button-outline" onClick={onClose}>Vazgeç</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? 'Kaydediliyor…' : <><Check size={15} />{mode === 'receipt' ? 'Stoğa ekle' : 'Sayımı kaydet'}</>}</button></div>
    </form>
  </ModalShell>;
}

function ModalShell({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  return <div className="overlay modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card inventory-modal" role="dialog" aria-modal="true" aria-labelledby="inventory-modal-title"><header className="modal-header"><div><span className="eyebrow">ÇALIŞKANLAR YAPI MARKET</span><h2 id="inventory-modal-title">{title}</h2><p>{subtitle}</p></div><button type="button" className="icon-button" onClick={onClose} aria-label="Pencereyi kapat"><X size={18} /></button></header>{children}</section></div>;
}
