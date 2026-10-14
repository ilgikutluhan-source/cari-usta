import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity, AlertCircle, Archive, ArrowDownLeft, ArrowRight, ArrowUpRight,
  BadgeCheck, Banknote, Bell, CalendarClock, Check, ChevronDown, CircleHelp,
  Clock3, Download, Filter, Hammer, LayoutDashboard, ListFilter, LoaderCircle, LockKeyhole,
  LogOut, Menu, MessageCircle, Moon, Package, Pencil, Plus, Printer, RotateCcw, Search, Share2, ShieldCheck, ShoppingCart,
  SlidersHorizontal, Sun, Trash2, Users, Wallet, X,
} from 'lucide-react';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut, type User } from 'firebase/auth';
import { auth, isFirebaseConfigured, workspaceOwnerUid } from './firebase';
import { archiveCustomer, createCustomer, createMovement, updateCustomerProfile, updateDueDate, watchActivity, watchCustomerEntries, watchCustomers } from './services/cari';
import { adjustInventoryStock, createInventoryProduct, setInventoryProductActive, updateInventoryProduct, watchInventory, watchStockActivity } from './services/inventory';
import { createCashSale, watchCashSales } from './services/cash-sales';
import { createStaffAccount, ensureWorkspaceMembership, watchWorkspaceMembers, type WorkspaceMember, type WorkspaceRole } from './services/members';
import { applyInputFormatter, formatMoneyInputWithCaret, formatTurkishPhoneInputWithCaret, ungroupMoneyInputWithCaret } from './input-formatting';
import './sales.css';
import TeamPanel from './components/TeamPanel';
import { InventoryPage } from './components/InventoryPage';
import { CashSalesPage } from './components/CashSalesPage';
import ResetDataPanel from './components/ResetDataPanel';
import CustomerPrint, { type CustomerPrintMode } from './components/CustomerPrint';
import NotificationsPanel, { type DueReminder, type PaymentReminder } from './components/NotificationsPanel';
import { dateOffset, formatDate, formatMoneyInput, formatQuantity, makeDemoStore, money, parseDate, parseMoneyInput, parseQuantityMilli, paymentMethodLabel, saleItemLineTotal, saleItemQuantity, saleItemUnitPrice, saleLineTotalCents, saleVatBreakdown, splitVatInclusiveCents, todayIso, VAT_RATE_BPS, type CashSale, type CashSaleCreateInput, type Customer, type DemoStore, type EntryType, type InventoryProduct, type LedgerEntry, type SaleItemInput, type StockMovement, type StockMovementType, type StoredSaleItem } from './models';
import { aggregateInventoryRequests, validateInventorySale, type InventoryProductInput } from './inventory-validation';
import { createWhatsAppReminderMessage, createWhatsAppReminderUrl } from './whatsapp';
import { createCustomerStatementPdf, downloadPdfFile } from './statement-pdf';
import type { ResetLedgerResult } from './services/reset-ledger';
import './notifications.css';
import './inventory.css';
import './cash-sales.css';

const DEMO_KEY = 'cari-usta-demo-v1';
const THEME_KEY = 'cari-usta-theme';
type ThemeMode = 'light' | 'dark';
type TabId = 'overview' | 'accounts' | 'inventory' | 'cash-sales' | 'due' | 'activity' | 'archived' | 'users';
type DialogState = 'customer' | { customerEdit: string } | { movement: 'debt' | 'payment'; customerId?: string } | 'due' | null;
type ProductDraft = { id: string; productId: string; name: string; quantity: string; unit: string; unitPrice: string };
type PreparedStatementPdf = { file: File; whatsappUrl: string; message: string; supportsFileShare: boolean };

const makeProductDraft = (): ProductDraft => ({ id: crypto.randomUUID(), productId: '', name: '', quantity: '1', unit: 'adet', unitPrice: '' });
const isProductSaleEntry = (entry: LedgerEntry) => entry.type === 'sale' || Boolean(entry.items?.length) || entry.vatRateBps === VAT_RATE_BPS;

const navItems: { id: TabId; label: string; icon: typeof LayoutDashboard }[] = [
  { id: 'overview', label: 'Genel Bakış', icon: LayoutDashboard },
  { id: 'accounts', label: 'Cari Hesaplar', icon: Users },
  { id: 'inventory', label: 'Stok', icon: Package },
  { id: 'cash-sales', label: 'Peşin Satış', icon: Banknote },
  { id: 'due', label: 'Vade Takvimi', icon: CalendarClock },
  { id: 'activity', label: 'Hareketler', icon: Activity },
  { id: 'archived', label: 'Arşiv', icon: Archive },
  { id: 'users', label: 'Kullanıcılar', icon: ShieldCheck },
];

function readDemo(): DemoStore {
  try {
    const saved = localStorage.getItem(DEMO_KEY);
    if (saved) {
      const value = JSON.parse(saved) as DemoStore;
      if (Array.isArray(value.customers) && Array.isArray(value.entries)) {
        const defaults = makeDemoStore();
        return {
          ...value,
          products: Array.isArray(value.products) ? value.products : defaults.products,
          stockActivity: Array.isArray(value.stockActivity) ? value.stockActivity : defaults.stockActivity,
          cashSales: Array.isArray(value.cashSales) ? value.cashSales : [],
        };
      }
    }
  } catch { /* Eski/bozuk örnek veri varsa yeni demo oluşturulur. */ }
  return makeDemoStore();
}

function readTheme(): ThemeMode {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark' || saved === 'light') return saved;
  } catch { /* Tarayıcı depolaması kullanılamıyorsa sistem tercihi kullanılır. */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function ThemeToggle({ theme, onToggle, className = '' }: { theme: ThemeMode; onToggle: () => void; className?: string }) {
  const label = theme === 'dark' ? 'Açık moda geç' : 'Karanlık moda geç';
  const Icon = theme === 'dark' ? Sun : Moon;
  return <button type="button" className={`icon-button theme-toggle ${className}`} onClick={onToggle} aria-label={label} aria-pressed={theme === 'dark'} title={label}><Icon size={18} strokeWidth={1.8} /></button>;
}

function initials(name: string) {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toLocaleUpperCase('tr-TR');
}

function dueState(customer: Customer) {
  if (customer.balance <= 0) return { label: 'Kapandı', className: 'paid', icon: Check };
  if (!customer.currentDueDate) return { label: 'Vade girilmedi', className: 'none', icon: CircleHelp };
  const due = parseDate(customer.currentDueDate);
  const today = parseDate(todayIso());
  if (!due || !today) return { label: 'Vade girilmedi', className: 'none', icon: CircleHelp };
  const days = Math.round((due.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { label: `${Math.abs(days)} gün gecikti`, className: 'overdue', icon: AlertCircle };
  if (days <= 7) return { label: days === 0 ? 'Bugün vadesi' : `${days} gün kaldı`, className: 'soon', icon: Clock3 };
  return { label: 'Vadesi var', className: 'current', icon: CalendarClock };
}

function activityTitle(type: EntryType, hasProducts = false, vatRateBps?: number) {
  if (type === 'payment') return 'Tahsilat alındı';
  if (type === 'debt') return hasProducts || vatRateBps === VAT_RATE_BPS ? 'Satış' : 'Yeni borç kaydı';
  if (type === 'sale') return 'Satış';
  return 'Vade güncellendi';
}

function App() {
  const demoMode = !isFirebaseConfigured;
  const [demoStore, setDemoStore] = useState<DemoStore>(readDemo);
  const [user, setUser] = useState<User | null>(null);
  const [workspaceRole, setWorkspaceRole] = useState<WorkspaceRole | null>(null);
  const [workspaceMembers, setWorkspaceMembers] = useState<WorkspaceMember[]>([]);
  const [authLoading, setAuthLoading] = useState(isFirebaseConfigured && Boolean(workspaceOwnerUid));
  const [cloudCustomers, setCloudCustomers] = useState<Customer[]>([]);
  const [cloudActivity, setCloudActivity] = useState<LedgerEntry[]>([]);
  const [cloudInventory, setCloudInventory] = useState<InventoryProduct[]>([]);
  const [cloudStockActivity, setCloudStockActivity] = useState<StockMovement[]>([]);
  const [cloudCashSales, setCloudCashSales] = useState<CashSale[]>([]);
  const [customerEntries, setCustomerEntries] = useState<LedgerEntry[]>([]);
  const [tab, setTab] = useState<TabId>('overview');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toast, setToast] = useState('');
  const [authError, setAuthError] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [theme, setTheme] = useState<ThemeMode>(readTheme);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const notificationRef = useRef<HTMLDivElement>(null);

  function toggleTheme() {
    const nextTheme: ThemeMode = theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem(THEME_KEY, nextTheme); } catch { /* Tema yine de bu oturumda değişir. */ }
    setTheme(nextTheme);
  }

  const allCustomers = demoMode ? demoStore.customers : cloudCustomers;
  const customers = allCustomers.filter((customer) => !customer.archivedAt);
  const archivedCustomers = allCustomers.filter((customer) => Boolean(customer.archivedAt));
  const selected = allCustomers.find((item) => item.id === selectedId) ?? null;
  const entries = demoMode ? demoStore.entries : cloudActivity;
  const stockProducts = demoMode ? (demoStore.products ?? []) : cloudInventory;
  const stockActivity = demoMode ? (demoStore.stockActivity ?? []) : cloudStockActivity;
  const cashSales = demoMode ? (demoStore.cashSales ?? []) : cloudCashSales;

  useEffect(() => {
    if (demoMode) {
      localStorage.setItem(DEMO_KEY, JSON.stringify(demoStore));
    }
  }, [demoMode, demoStore]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
  }, [theme]);

  useEffect(() => {
    const currentAuth = auth;
    if (!currentAuth || !workspaceOwnerUid) {
      setAuthLoading(false);
      return;
    }
    return onAuthStateChanged(currentAuth, (nextUser) => {
      if (!nextUser) {
        setUser(null);
        setWorkspaceRole(null);
        setWorkspaceMembers([]);
        setAuthLoading(false);
        setTab('overview');
        return;
      }

      setAuthLoading(true);
      void ensureWorkspaceMembership(nextUser, workspaceOwnerUid)
        .then((role) => {
          setUser(nextUser);
          setWorkspaceRole(role);
          setAuthError('');
        })
        .catch(async (reason) => {
          setUser(null);
          setWorkspaceRole(null);
          setAuthError(reason instanceof Error ? reason.message : 'Bu hesabın ortak cari defterine erişim yetkisi yok.');
          await signOut(currentAuth);
        })
        .finally(() => setAuthLoading(false));
    });
  }, []);

  useEffect(() => {
    if (demoMode || !user || !workspaceOwnerUid || !workspaceRole) {
      setCloudCustomers([]);
      setCloudActivity([]);
      setCloudInventory([]);
      setCloudStockActivity([]);
      setCloudCashSales([]);
      return;
    }
    const fail = () => showToast('Firebase verilerine ulaşılamadı. Firestore ayarlarını ve güvenlik kurallarını kontrol edin.');
    const stopCustomers = watchCustomers(workspaceOwnerUid, setCloudCustomers, fail);
    const stopActivity = watchActivity(workspaceOwnerUid, setCloudActivity, fail);
    const stopInventory = watchInventory(workspaceOwnerUid, setCloudInventory, fail);
    const stopStockActivity = watchStockActivity(workspaceOwnerUid, setCloudStockActivity, fail);
    const stopCashSales = watchCashSales(workspaceOwnerUid, setCloudCashSales, fail);
    return () => { stopCustomers(); stopActivity(); stopInventory(); stopStockActivity(); stopCashSales(); };
  }, [demoMode, user, workspaceRole]);

  useEffect(() => {
    if (demoMode || !user || workspaceRole !== 'owner' || !workspaceOwnerUid) {
      setWorkspaceMembers([]);
      return;
    }
    return watchWorkspaceMembers(workspaceOwnerUid, setWorkspaceMembers, () => showToast('Kullanıcı listesi okunamadı. Firestore kurallarının güncel olduğunu kontrol edin.'));
  }, [demoMode, user, workspaceRole]);

  useEffect(() => {
    if (!selected || demoMode || !user || !workspaceOwnerUid || !workspaceRole) {
      setCustomerEntries(demoMode && selected ? demoStore.entries.filter((entry) => entry.customerId === selected.id).sort((a, b) => b.date.localeCompare(a.date)) : []);
      return;
    }
    return watchCustomerEntries(workspaceOwnerUid, selected.id, setCustomerEntries, () => showToast('Cari hareketleri yüklenemedi.'));
  }, [selected?.id, demoMode, user, workspaceRole, demoStore.entries]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(''), 3400);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!notificationsOpen) return;
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (!notificationRef.current?.contains(event.target as Node)) setNotificationsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setNotificationsOpen(false);
      document.getElementById('notifications-toggle')?.focus();
    };
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [notificationsOpen]);

  function showToast(message: string) { setToast(message); }

  const totals = useMemo(() => {
    const balance = customers.reduce((sum, customer) => sum + customer.balance, 0);
    const overdue = customers.filter((customer) => dueState(customer).className === 'overdue').reduce((sum, customer) => sum + customer.balance, 0);
    const active = customers.filter((customer) => customer.balance > 0).length;
    return { balance, overdue, active };
  }, [customers]);

  const filteredCustomers = useMemo(() => {
    const q = search.trim().toLocaleLowerCase('tr-TR');
    return customers.filter((customer) => {
      const matchesSearch = !q || `${customer.name} ${customer.company} ${customer.phone}`.toLocaleLowerCase('tr-TR').includes(q);
      const state = dueState(customer).className;
      const matchesFilter = filter === 'all'
        || (filter === 'overdue' && state === 'overdue')
        || (filter === 'soon' && state === 'soon')
        || (filter === 'open' && customer.balance > 0)
        || (filter === 'closed' && customer.balance <= 0);
      const matchesTab = tab !== 'due' || ['overdue', 'soon', 'current', 'none'].includes(state);
      return matchesSearch && matchesFilter && matchesTab;
    }).sort((a, b) => b.balance - a.balance);
  }, [customers, search, filter, tab]);

  const recentEntries = useMemo(() => [...entries].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8), [entries]);
  const dueReminders = useMemo<DueReminder[]>(() => customers
    .map((customer) => ({ customer, state: dueState(customer) }))
    .filter(({ state }) => state.className === 'overdue' || state.className === 'soon')
    .sort((a, b) => {
      const urgency = (a.state.className === 'overdue' ? 0 : 1) - (b.state.className === 'overdue' ? 0 : 1);
      return urgency || (a.customer.currentDueDate || '').localeCompare(b.customer.currentDueDate || '');
    })
    .map(({ customer, state }) => ({
      customer,
      status: state.className as DueReminder['status'],
      statusLabel: state.label,
    })), [customers]);
  const paymentReminders = useMemo<PaymentReminder[]>(() => [...entries]
    .filter((entry) => entry.type === 'payment')
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 5)
    .map((entry) => {
      const customer = allCustomers.find((item) => item.id === entry.customerId);
      return {
        entry,
        customerName: customer?.name ?? entry.customerName ?? 'Müşteri',
        company: customer?.company ?? '',
      };
    }), [allCustomers, entries]);
  const notificationCount = dueReminders.length + paymentReminders.length;

  async function handleCustomer(data: Pick<Customer, 'name' | 'phone' | 'company' | 'note'>) {
    if (demoMode) {
      const customer: Customer = { id: `demo-${crypto.randomUUID()}`, ...data, currentDueDate: '', totalDebt: 0, totalPaid: 0, balance: 0 };
      setDemoStore((previous) => ({ ...previous, customers: [customer, ...previous.customers] }));
    } else if (user && workspaceOwnerUid) {
      await createCustomer(workspaceOwnerUid, data);
    }
    setDialog(null);
    showToast('Yeni cari hesap oluşturuldu.');
  }

  async function handleCustomerProfileUpdate(customerId: string, data: Pick<Customer, 'name' | 'phone'>) {
    const current = allCustomers.find((customer) => customer.id === customerId);
    if (!current) throw new Error('Müşteri kaydı bulunamadı. Listeyi yenileyip tekrar deneyin.');
    const name = data.name.trim();
    const phone = data.phone.trim();
    if (name === current.name && phone === current.phone) {
      setDialog(null);
      showToast('Müşteri bilgilerinde değişiklik yok.');
      return;
    }
    if (demoMode) {
      setDemoStore((previous) => ({
        ...previous,
        customers: previous.customers.map((customer) => customer.id === customerId ? { ...customer, name, phone } : customer),
      }));
    } else if (user && workspaceOwnerUid && workspaceRole) {
      await updateCustomerProfile(workspaceOwnerUid, customerId, { name, phone });
    } else {
      throw new Error('Müşteri bilgisini değiştirmek için yetkili kullanıcı oturumu açın.');
    }
    setDialog(null);
    showToast(demoMode ? 'Müşteri bilgileri demo görünümünde güncellendi.' : 'Müşteri adı ve telefonu güncellendi; diğer cihazlara eşitleniyor.');
  }

  async function handleInventoryCreate(data: InventoryProductInput) {
    if (demoMode) {
      const productId = `demo-product-${crypto.randomUUID()}`;
      const movementId = data.openingStockMilli > 0 ? `demo-stock-${crypto.randomUUID()}` : '';
      const product: InventoryProduct = {
        id: productId, name: data.name, sku: data.sku, unit: data.unit,
        salePriceCents: data.salePriceCents, stockQuantityMilli: data.openingStockMilli,
        lowStockThresholdMilli: data.lowStockThresholdMilli, active: true,
        lastStockMovementId: movementId, createdBy: 'demo',
      };
      const movement: StockMovement | null = data.openingStockMilli > 0 ? {
        id: movementId, type: 'opening', productDeltas: { [productId]: data.openingStockMilli },
        previousQuantities: { [productId]: 0 }, nextQuantities: { [productId]: data.openingStockMilli },
        productNames: { [productId]: data.name }, date: todayIso(), note: 'Açılış stoğu', createdBy: 'demo',
      } : null;
      setDemoStore((previous) => ({
        ...previous,
        products: [product, ...(previous.products ?? [])],
        stockActivity: movement ? [movement, ...(previous.stockActivity ?? [])] : (previous.stockActivity ?? []),
      }));
    } else if (workspaceOwnerUid && user) {
      await createInventoryProduct(workspaceOwnerUid, user.uid, data);
    } else {
      throw new Error('Ürün oluşturmak için yetkili kullanıcı oturumu açın.');
    }
    showToast(demoMode ? 'Ürün demo stoğuna eklendi.' : 'Ürün ve açılış stoğu ortak kataloğa eklendi.');
  }

  async function handleInventoryUpdate(productId: string, data: InventoryProductInput) {
    if (demoMode) {
      setDemoStore((previous) => ({
        ...previous,
        products: (previous.products ?? []).map((product) => product.id === productId ? {
          ...product, name: data.name, sku: data.sku, unit: data.unit,
          salePriceCents: data.salePriceCents, lowStockThresholdMilli: data.lowStockThresholdMilli,
        } : product),
      }));
    } else if (workspaceOwnerUid && user) {
      await updateInventoryProduct(workspaceOwnerUid, productId, data);
    } else {
      throw new Error('Ürün düzenlemek için yetkili kullanıcı oturumu açın.');
    }
    showToast(demoMode ? 'Ürün demo kataloğunda güncellendi.' : 'Ürün bilgileri ortak katalogda güncellendi.');
  }

  async function handleInventoryActive(productId: string, active: boolean) {
    if (demoMode) {
      setDemoStore((previous) => ({
        ...previous,
        products: (previous.products ?? []).map((product) => product.id === productId ? { ...product, active } : product),
      }));
    } else if (workspaceOwnerUid && user) {
      await setInventoryProductActive(workspaceOwnerUid, productId, active);
    } else {
      throw new Error('Ürün durumunu değiştirmek için yetkili kullanıcı oturumu açın.');
    }
    showToast(active ? 'Ürün aktif kataloğa geri yüklendi.' : 'Ürün geçmişi korunarak arşivlendi.');
  }

  async function handleInventoryAdjustment(product: InventoryProduct, deltaMilli: number, type: Extract<StockMovementType, 'receipt' | 'adjustment'>, date: string, note: string) {
    if (!Number.isSafeInteger(deltaMilli) || deltaMilli === 0) throw new Error('Stok değişikliği sıfırdan farklı olmalıdır.');
    if (demoMode) {
      const current = (demoStore.products ?? []).find((item) => item.id === product.id);
      if (!current) throw new Error('Ürün bulunamadı. Listeyi yenileyip tekrar deneyin.');
      const nextQuantity = current.stockQuantityMilli + deltaMilli;
      if (nextQuantity < 0) throw new Error('Stok miktarı sıfırın altına düşemez.');
      if (nextQuantity > 1_000_000_000) throw new Error('Stok miktarı izin verilen üst sınırı aşıyor.');
      const movementId = `demo-stock-${crypto.randomUUID()}`;
      const movement: StockMovement = {
        id: movementId, type, productDeltas: { [current.id]: deltaMilli },
        previousQuantities: { [current.id]: current.stockQuantityMilli },
        nextQuantities: { [current.id]: nextQuantity }, productNames: { [current.id]: current.name },
        date, note, createdBy: 'demo',
      };
      setDemoStore((previous) => ({
        ...previous,
        products: (previous.products ?? []).map((item) => item.id === product.id ? { ...item, stockQuantityMilli: nextQuantity, lastStockMovementId: movementId } : item),
        stockActivity: [movement, ...(previous.stockActivity ?? [])],
      }));
    } else if (workspaceOwnerUid && user) {
      await adjustInventoryStock(workspaceOwnerUid, user.uid, product, deltaMilli, type, date, note);
    } else {
      throw new Error('Stok hareketi kaydetmek için yetkili kullanıcı oturumu açın.');
    }
    showToast(type === 'receipt' ? 'Stok girişi kaydedildi.' : 'Sayım düzeltmesi kaydedildi.');
  }

  async function handleCashSale(input: CashSaleCreateInput): Promise<CashSale> {
    const vat = splitVatInclusiveCents(input.amountCents);
    if (!vat) throw new Error('Peşin satış toplamı geçersiz.');
    const saleItems: SaleItemInput[] = input.items.map((item) => ({
      name: item.name,
      quantity: item.quantityMilli / 1000,
      unit: item.unit,
      unitPrice: item.unitPriceCents / 100,
      lineTotal: item.lineTotalCents / 100,
      productId: item.productId,
    }));
    const inventoryError = validateInventorySale(saleItems, stockProducts);
    if (inventoryError) throw new Error(inventoryError);
    for (const item of input.items) {
      const product = stockProducts.find((candidate) => candidate.id === item.productId && candidate.active);
      if (!product || product.name !== item.name || product.unit !== item.unit || product.salePriceCents !== item.unitPriceCents) {
        throw new Error('Ürün bilgisi veya fiyatı değişmiş. Ürünü yeniden seçip tekrar deneyin.');
      }
    }
    const customer = input.customerId ? customers.find((item) => item.id === input.customerId) : undefined;
    if (input.customerId && (!customer || customer.archivedAt)) throw new Error('Seçilen müşteri artık aktif değil.');
    let saved: CashSale;
    if (demoMode) {
      const saleId = input.saleId || `demo-cash-${crypto.randomUUID()}`;
      const sale: CashSale = {
        id: saleId,
        invoiceNumber: `PS-${input.date.replaceAll('-', '')}-${saleId.slice(-8).toLocaleUpperCase('tr-TR')}`,
        ...input,
        vatRateBps: vat.vatRateBps,
        vatBaseCents: vat.vatBaseCents,
        vatCents: vat.vatCents,
        ...(customer ? { customerId: customer.id, customerName: customer.name, customerPhone: customer.phone, customerCompany: customer.company } : {}),
        createdBy: 'demo',
        createdAt: new Date().toISOString(),
      };
      const requests = aggregateInventoryRequests(saleItems);
      const movements = [...requests].map(([productId, quantityMilli]) => {
        const product = stockProducts.find((item) => item.id === productId);
        if (!product) throw new Error('Satış ürünü bulunamadı.');
        return {
          id: `demo-cash-stock-${crypto.randomUUID()}`,
          type: 'sale' as const,
          productId,
          quantityMilli,
          previousMilli: product.stockQuantityMilli,
          nextMilli: product.stockQuantityMilli - quantityMilli,
          productName: product.name,
        };
      });
      const movementByProduct = new Map<string, StockMovement>();
      for (const movement of movements) movementByProduct.set(movement.productId, {
        id: movement.id,
        type: 'sale',
        productDeltas: { [movement.productId]: -movement.quantityMilli },
        previousQuantities: { [movement.productId]: movement.previousMilli },
        nextQuantities: { [movement.productId]: movement.nextMilli },
        productNames: { [movement.productId]: movement.productName },
        date: input.date,
        note: `Peşin satış · ${sale.invoiceNumber}`,
        cashSaleId: sale.id,
        createdBy: 'demo',
      });
      setDemoStore((previous) => ({
        ...previous,
        cashSales: [sale, ...(previous.cashSales ?? [])],
        products: (previous.products ?? []).map((product) => {
          const movement = movementByProduct.get(product.id);
          return movement ? {
            ...product,
            stockQuantityMilli: movement.nextQuantities[product.id],
            lastStockMovementId: movement.id,
          } : product;
        }),
        stockActivity: [...movementByProduct.values(), ...(previous.stockActivity ?? [])],
      }));
      saved = sale;
    } else if (user && workspaceOwnerUid) {
      saved = await createCashSale(workspaceOwnerUid, user.uid, input);
    } else {
      throw new Error('Peşin satış kaydetmek için yetkili kullanıcı oturumu açın.');
    }
    showToast('Peşin satış kaydedildi; stok güncellendi, cari hesap değişmedi.');
    return saved;
  }

  async function handleMovement(customer: Customer, type: 'debt' | 'payment', amount: number, date: string, note: string, nextDueDate: string, items?: SaleItemInput[]) {
    if (type === 'payment' && amount > customer.balance) throw new Error('Tahsilat tutarı kalan bakiyeyi aşamaz.');
    if (type === 'payment' && items?.length) throw new Error('Ürün satırları yalnızca satış hareketine eklenebilir.');
    if (type === 'debt' && items?.some((item) => Boolean(item.productId))) {
      const inventoryError = validateInventorySale(items, stockProducts);
      if (inventoryError) throw new Error(inventoryError);
    }
    const amountCents = Math.round(amount * 100);
    if (!Number.isSafeInteger(amountCents) || amountCents <= 0 || amountCents > 1_000_000_000_000) throw new Error('Tutar kuruş hassasiyetinde ve izin verilen sınırlar içinde olmalıdır.');
    const normalizedAmount = amountCents / 100;
    const vatFields = type === 'debt' ? splitVatInclusiveCents(amountCents) : null;
    if (type === 'debt' && !vatFields) throw new Error('Satış tutarı için KDV ayrıştırılamadı.');
    const vatMetadata = vatFields ? {
      vatRateBps: vatFields.vatRateBps,
      vatBaseCents: vatFields.vatBaseCents,
      vatCents: vatFields.vatCents,
    } : null;
    const productItems: StoredSaleItem[] | undefined = items?.length ? items.map((item) => {
      const quantityMilli = Math.round(item.quantity * 1000);
      const unitPriceCents = Math.round(item.unitPrice * 100);
      const lineTotalCents = Math.round(item.lineTotal * 100);
      return { name: item.name.trim(), quantityMilli, unit: item.unit.trim(), unitPriceCents, lineTotalCents, ...(item.productId ? { productId: item.productId } : {}) };
    }) : undefined;
    if (productItems && productItems.reduce((total, item) => total + (item.lineTotalCents ?? 0), 0) !== amountCents) throw new Error('Satış toplamı ürün satırlarının toplamıyla eşleşmiyor.');
    const stockRequests = type === 'debt' && items ? aggregateInventoryRequests(items) : new Map<string, number>();
    if (demoMode) {
      const stockDeltas = Object.fromEntries([...stockRequests].map(([id, quantity]) => [id, -quantity]));
      const entry: LedgerEntry = { id: `entry-${crypto.randomUUID()}`, type, amount: normalizedAmount, amountCents, date, note, customerId: customer.id, customerName: customer.name, ...(productItems ? { items: productItems } : {}), ...(stockRequests.size ? { stockDeltas } : {}), ...(vatMetadata ?? {}), ...(type === 'debt' ? { nextDueDate: nextDueDate || customer.currentDueDate } : {}) };
      const previousQuantities: Record<string, number> = {};
      const nextQuantities: Record<string, number> = {};
      const productNames: Record<string, string> = {};
      for (const [productId, quantity] of stockRequests) {
        const product = stockProducts.find((item) => item.id === productId);
        if (!product) throw new Error('Satışta seçilen stok ürünü bulunamadı.');
        previousQuantities[productId] = product.stockQuantityMilli;
        nextQuantities[productId] = product.stockQuantityMilli - quantity;
        productNames[productId] = product.name;
      }
      const stockMovement: StockMovement | null = stockRequests.size ? {
        id: `demo-stock-${crypto.randomUUID()}`, type: 'sale', productDeltas: stockDeltas,
        previousQuantities, nextQuantities, productNames, date, note,
        customerId: customer.id, customerName: customer.name, saleTransactionId: entry.id, createdBy: 'demo',
      } : null;
      setDemoStore((previous) => ({
        ...previous,
        customers: previous.customers.map((item) => {
          if (item.id !== customer.id) return item;
          const nextDebtCents = Math.round(item.totalDebt * 100) + (type === 'debt' ? amountCents : 0);
          const nextPaidCents = Math.round(item.totalPaid * 100) + (type === 'payment' ? amountCents : 0);
          const nextBalanceCents = Math.round(item.balance * 100) + (type === 'debt' ? amountCents : -amountCents);
          return {
            ...item,
            totalDebt: nextDebtCents / 100,
            totalPaid: nextPaidCents / 100,
            balance: nextBalanceCents / 100,
            ...(type === 'debt' && nextDueDate ? { currentDueDate: nextDueDate } : {}),
            ...(type === 'payment' && nextBalanceCents === 0 ? { currentDueDate: '' } : {}),
          };
        }),
        entries: [entry, ...previous.entries],
        products: (previous.products ?? []).map((product) => product.id in nextQuantities ? { ...product, stockQuantityMilli: nextQuantities[product.id], lastStockMovementId: stockMovement?.id ?? product.lastStockMovementId } : product),
        stockActivity: stockMovement ? [stockMovement, ...(previous.stockActivity ?? [])] : (previous.stockActivity ?? []),
      }));
    } else if (user && workspaceOwnerUid) {
      await createMovement(workspaceOwnerUid, user.uid, customer, { type, amount: normalizedAmount, date, note, ...(items?.length ? { items } : {}), ...(type === 'debt' ? { nextDueDate: nextDueDate || customer.currentDueDate } : {}) });
    }
    setDialog(null);
    showToast(type === 'payment' ? 'Tahsilat kaydedildi.' : stockRequests.size ? 'Satış kaydedildi; cari borç ve stok birlikte güncellendi.' : productItems ? 'Ürünlü satış kaydedildi; ürün toplamı cari borca eklendi.' : 'Satış kaydedildi; tutar cari borca eklendi.');
  }

  async function handleDueDate(customer: Customer, nextDueDate: string) {
    const date = todayIso();
    if (demoMode) {
      const entry: LedgerEntry = { id: `entry-${crypto.randomUUID()}`, type: 'due_update', amount: 0, date, note: 'Ödeme vadesi güncellendi', customerId: customer.id, customerName: customer.name, previousDueDate: customer.currentDueDate, nextDueDate };
      setDemoStore((previous) => ({
        ...previous,
        customers: previous.customers.map((item) => item.id === customer.id ? { ...item, currentDueDate: nextDueDate } : item),
        entries: [entry, ...previous.entries],
      }));
    } else if (user && workspaceOwnerUid) {
      await updateDueDate(workspaceOwnerUid, customer, nextDueDate, date);
    }
    setDialog(null);
    showToast('Ödeme vadesi güncellendi.');
  }

  async function handleArchive(customer: Customer, archived: boolean) {
    if (demoMode) {
      setDemoStore((previous) => ({
        ...previous,
        customers: previous.customers.map((item) => item.id !== customer.id ? item : {
          ...item,
          archivedAt: archived ? new Date().toISOString() : '',
        }),
      }));
    } else if (workspaceOwnerUid && workspaceRole) {
      await archiveCustomer(workspaceOwnerUid, customer.id, archived);
    }
    setSelectedId(null);
    showToast(archived ? 'Cari arşivlendi; diğer kullanıcıların listesinden de kaldırıldı.' : 'Cari ortak aktif listeye geri yüklendi.');
  }

  async function handleCreateStaff(data: { displayName: string; email: string; password: string }) {
    if (!user || workspaceRole !== 'owner' || !workspaceOwnerUid) {
      throw new Error('Çalışan hesabı oluşturma yetkisi yalnızca işletme sahibindedir.');
    }
    await createStaffAccount(workspaceOwnerUid, user, data.displayName, data.email, data.password);
    showToast('Çalışan hesabı oluşturuldu; ortak cari defterine erişim verildi.');
  }

  function handleResetComplete(result: ResetLedgerResult) {
    setSelectedId(null);
    setCustomerEntries([]);
    setCloudCustomers([]);
    setCloudActivity([]);
    showToast(`Cari verileri sıfırlandı: ${result.deletedCustomers} müşteri, ${result.deletedTransactions} hareket ve ${result.deletedActivity} aktivite kaydı silindi. Kullanıcı hesapları korundu.`);
  }

  async function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthError('');
    setAuthBusy(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get('email') ?? '').trim();
    const password = String(form.get('password') ?? '');
    try {
      if (!auth) throw new Error('Firebase Auth bağlantısı bulunamadı.');
      await signInWithEmailAndPassword(auth, email, password);
    } catch (error) {
      const code = (error as { code?: string }).code;
      const messages: Record<string, string> = {
        'auth/invalid-credential': 'E-posta veya şifre doğru değil.',
        'auth/invalid-email': 'Geçerli bir e-posta adresi yazın.',
        'auth/too-many-requests': 'Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.',
        'auth/network-request-failed': 'Bağlantı kurulamadı. İnternetinizi kontrol edin.',
      };
      setAuthError(code ? (messages[code] ?? 'Oturum açılamadı. Firebase Authentication ayarlarını kontrol edin.') : (error instanceof Error ? error.message : 'Bir hata oluştu.'));
    } finally {
      setAuthBusy(false);
    }
  }

  async function logout() {
    if (auth) await signOut(auth);
  }

  if (!demoMode && !workspaceOwnerUid) return <WorkspaceSetup theme={theme} onToggleTheme={toggleTheme} />;
  if (authLoading) return <div className="loading-screen"><div className="loader-mark"><Hammer size={23} /></div><span>Ortak cari defteri hazırlanıyor…</span></div>;
  if (!demoMode && (!user || !workspaceRole)) return <AuthScreen onSubmit={submitAuth} error={authError} busy={authBusy} theme={theme} onToggleTheme={toggleTheme} />;

  const pageTitle: Record<TabId, string> = { overview: 'Genel Bakış', accounts: 'Cari Hesaplar', inventory: 'Stok Takibi', 'cash-sales': 'Peşin Satış', due: 'Vade Takvimi', activity: 'Hesap Hareketleri', archived: 'Arşiv', users: 'Kullanıcılar' };
  const selectedRows = tab === 'overview' && !search.trim() ? [...customers].sort((a, b) => b.balance - a.balance).slice(0, 5) : filteredCustomers;
  const selectedEntries = selected ? (demoMode ? demoStore.entries.filter((entry) => entry.customerId === selected.id).sort((a, b) => b.date.localeCompare(a.date)) : customerEntries) : [];

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileMenu ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-symbol"><img src="/cari-usta-logo.svg" alt="" /></div>
          <div><div className="brand-name brand-name-stack">Çalışkanlar</div><div className="brand-caption">YAPI MARKET</div></div>
          <button className="mobile-close icon-button" onClick={() => setMobileMenu(false)} aria-label="Menüyü kapat"><X size={18} /></button>
        </div>
        <div className="store-chip"><div className="store-icon">ÇM</div><div className="store-name"><strong>Çalışkanlar</strong><span>Ortak cari defteri</span></div><ChevronDown size={15} /></div>
        <div className="nav-label">ÇALIŞMA ALANI</div>
        <nav className="sidebar-nav" aria-label="Ana menü">
          {navItems.filter(({ id }) => id !== 'users' || workspaceRole === 'owner').map(({ id, label, icon: Icon }) => (
            <button key={id} className={`nav-link ${tab === id ? 'active' : ''}`} onClick={() => { setTab(id); setMobileMenu(false); setFilter('all'); }}>
              <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{id === 'due' && totals.overdue > 0 && <span className="nav-count">!</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-tip"><div className="tip-icon"><ShieldCheck size={17} /></div><div><strong>Ortak defter güvenli</strong><span>Yalnızca davetli çalışanlar erişir.</span></div></div>
          <div className="profile-row"><div className="profile-avatar">{demoMode ? 'ÇM' : initials(user?.email ?? 'Ç')}</div><div className="profile-meta"><strong>{demoMode ? 'Çalışkanlar' : (user?.email ?? 'Hesabım')}</strong><span>{demoMode ? 'Örnek görünüm' : workspaceRole === 'owner' ? 'İşletme yöneticisi' : 'Yetkili çalışan'}</span></div>{!demoMode && <button className="icon-button logout-button" onClick={logout} title="Oturumu kapat" aria-label="Oturumu kapat"><LogOut size={16} /></button>}</div>
        </div>
      </aside>
      {mobileMenu && <button className="sidebar-scrim" aria-label="Menüyü kapat" onClick={() => setMobileMenu(false)} />}

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left"><button className="mobile-menu-button icon-button" onClick={() => setMobileMenu(true)} aria-label="Menüyü aç"><Menu size={19} /></button><span className="breadcrumb">Çalışkanlar</span><span className="breadcrumb-divider">/</span><span className="breadcrumb-current">{pageTitle[tab]}</span></div>
          <div className="topbar-actions">
            {tab !== 'users' && tab !== 'inventory' && tab !== 'cash-sales' && <div className="top-search"><Search size={16} /><input aria-label="Cari hesaplarda ara" placeholder="Cari hesaplarda ara…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>}
            <ThemeToggle theme={theme} onToggle={toggleTheme} className="topbar-theme-toggle" />
            <div className="notification-control" ref={notificationRef}>
              <button
                type="button"
                id="notifications-toggle"
                className="icon-button notification-button"
                aria-label={notificationsOpen ? 'Bildirimleri kapat' : notificationCount ? `Bildirimler, ${notificationCount} kayıt` : 'Bildirimler'}
                aria-expanded={notificationsOpen}
                aria-controls={notificationsOpen ? 'notifications-popover' : undefined}
                title="Bildirimler"
                onClick={() => setNotificationsOpen((isOpen) => !isOpen)}
              >
                <Bell size={18} />
                {notificationCount > 0 && <span className="notification-count" aria-hidden="true">{notificationCount > 9 ? '9+' : notificationCount}</span>}
              </button>
              {notificationsOpen && (
                <NotificationsPanel
                  dueReminders={dueReminders}
                  paymentReminders={paymentReminders}
                  onClose={() => setNotificationsOpen(false)}
                  onSelectCustomer={(customerId) => {
                    setSelectedId(customerId);
                    setNotificationsOpen(false);
                  }}
                />
              )}
            </div>
            {tab !== 'inventory' && tab !== 'cash-sales' && <button type="button" className="button button-primary top-add" aria-label="Yeni cari hesap oluştur" onClick={() => setDialog('customer')}><Plus size={16} /> Cari Ekle</button>}
          </div>
        </header>

        {demoMode && <div className="demo-banner"><div className="demo-banner-icon"><CircleHelp size={17} /></div><div><strong>Demo görünümü</strong><span>Örnek kayıtlar yalnızca bu tarayıcıda saklanır; Firebase bağlantısı eklendiğinde canlı cari hesaplar burada görünür.</span></div><a href="#firebase-setup" onClick={(event) => { event.preventDefault(); document.getElementById('firebase-setup')?.scrollIntoView({ behavior: 'smooth' }); }}>Kurulum bilgisi <ArrowRight size={14} /></a></div>}

        <div className="page-content">
          <section className="page-heading"><div><div className="eyebrow">{new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())}</div><h1>{pageTitle[tab]}<span className="heading-period">.</span></h1><p>{tab === 'overview' ? 'Aynı cari defteri, her cihazda güncel.' : tab === 'inventory' ? 'Ürün kataloğunu, mevcut miktarları ve stok hareketlerini yönetin.' : tab === 'cash-sales' ? 'Stoktan ürünü seçin, peşin satış belgesini oluşturun; cari bakiyeyi değiştirmeyin.' : tab === 'due' ? 'Yaklaşan ve gecikmiş ödeme vadelerini takip edin.' : tab === 'activity' ? 'İşletme kullanıcılarının ortak hesap hareketleri.' : tab === 'archived' ? 'Arşivlenen cariler ve korunmuş hareket geçmişleri.' : tab === 'users' ? 'Ortak cari defterine erişimi olan çalışan hesapları.' : 'Müşterilerinizi ve güncel bakiye durumlarını yönetin.'}</p></div></section>

          {tab === 'overview' && <>
            <section className="stats-grid" aria-label="Cari hesap özetleri">
              <StatCard label="TOPLAM AÇIK ALACAK" value={money(totals.balance)} note="Tüm açık cari bakiyeleri" icon={<Wallet size={18} />} tone="green" />
              <StatCard label="VADESİ GEÇEN" value={money(totals.overdue)} note={`${customers.filter((item) => dueState(item).className === 'overdue').length} cari hesapta gecikme`} icon={<AlertCircle size={18} />} tone="amber" />
              <StatCard label="AÇIK CARİ" value={String(totals.active).padStart(2, '0')} note={`${customers.length} kayıtlı müşteri içinden`} icon={<Users size={18} />} tone="blue" />
              <StatCard label="BUGÜNKÜ TARİH" value={new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short' }).format(new Date())} note="Kayıtlar yerel saate göre" icon={<CalendarClock size={18} />} tone="rose" />
            </section>
            <section className="overview-grid">
              <div className="panel accounts-panel"><div className="panel-heading"><div><h2>Öne çıkan cariler</h2><p>Bakiye tutarına göre sıralı</p></div><button className="text-button" onClick={() => setTab('accounts')}>Tümünü gör <ArrowRight size={15} /></button></div><CustomerTable customers={selectedRows} onSelect={(customer) => setSelectedId(customer.id)} compact /></div>
              <div className="panel due-panel"><div className="panel-heading"><div><h2>Vade takibi</h2><p>Öncelik gerektiren hesaplar</p></div><button className="round-link" aria-label="Vade takvimine git" onClick={() => setTab('due')}><ArrowRight size={16} /></button></div><DueList customers={customers.filter((item) => ['overdue', 'soon'].includes(dueState(item).className)).sort((a, b) => (a.currentDueDate || '').localeCompare(b.currentDueDate || '')).slice(0, 4)} onSelect={(customer) => setSelectedId(customer.id)} /></div>
            </section>
            <section className="panel activity-panel"><div className="panel-heading"><div><h2>Son hesap hareketleri</h2><p>İşletme cari defterindeki son kayıtlar</p></div><button className="text-button" onClick={() => setTab('activity')}>Tüm hareketler <ArrowRight size={15} /></button></div><ActivityList entries={recentEntries.slice(0, 5)} onSelect={(entry) => setSelectedId(entry.customerId)} /></section>
            {demoMode && <FirebaseSetup />}
          </>}

          {tab === 'accounts' && <section className="panel full-table-panel"><div className="panel-heading table-heading"><div><h2>Müşteri hesapları <span className="count-pill">{filteredCustomers.length}</span></h2><p>Arayın, bakiyeleri inceleyin ve hesap detayını açın.</p></div><div className="filter-control"><SlidersHorizontal size={15} /><select aria-label="Cari hesap filtresi" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Tüm cariler</option><option value="open">Açık bakiyeler</option><option value="overdue">Vadesi geçmiş</option><option value="soon">Vadesi yaklaşıyor</option><option value="closed">Bakiyesi kapalı</option></select><ChevronDown size={14} /></div></div><CustomerTable customers={filteredCustomers} onSelect={(customer) => setSelectedId(customer.id)} /></section>}

          {tab === 'inventory' && <InventoryPage
            products={stockProducts}
            movements={stockActivity}
            search={search}
            onSearchChange={setSearch}
            onCreate={handleInventoryCreate}
            onUpdate={handleInventoryUpdate}
            onSetActive={handleInventoryActive}
            onAdjust={handleInventoryAdjustment}
          />}

          {tab === 'cash-sales' && <CashSalesPage products={stockProducts} customers={customers} sales={cashSales} onCreate={handleCashSale} />}

          {tab === 'due' && <section className="panel full-table-panel"><div className="panel-heading table-heading"><div><h2>Vade listesi <span className="count-pill">{filteredCustomers.length}</span></h2><p>Açık bakiyesi olan cari hesapların ödeme tarihleri.</p></div><div className="filter-control"><Filter size={15} /><select aria-label="Vade filtresi" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Tüm vadeler</option><option value="overdue">Vadesi geçmiş</option><option value="soon">7 gün içinde</option></select><ChevronDown size={14} /></div></div><CustomerTable customers={filteredCustomers} onSelect={(customer) => setSelectedId(customer.id)} dueView /></section>}

          {tab === 'activity' && <section className="panel full-table-panel"><div className="panel-heading table-heading"><div><h2>Hesap hareketleri <span className="count-pill">{recentEntries.length}</span></h2><p>Son işlemler, en yeniden eskiye sıralanır.</p></div><div className="activity-legend"><span><i className="legend-dot debt-dot" /> Borç</span><span><i className="legend-dot payment-dot" /> Tahsilat</span></div></div><ActivityList entries={recentEntries} onSelect={(entry) => setSelectedId(entry.customerId)} large /></section>}

          {tab === 'archived' && <ArchivedCustomers customers={archivedCustomers.filter((customer) => `${customer.name} ${customer.company} ${customer.phone}`.toLocaleLowerCase('tr-TR').includes(search.toLocaleLowerCase('tr-TR')))} onRestore={(customer) => { void handleArchive(customer, false).catch(() => showToast('Cari geri yüklenemedi. Firestore kurallarını kontrol edin.')); }} onView={(customer) => setSelectedId(customer.id)} />}

          {tab === 'users' && workspaceRole === 'owner' && user && <div className="owner-settings-stack"><TeamPanel members={workspaceMembers} onCreate={handleCreateStaff} /><ResetDataPanel user={user} onResetComplete={handleResetComplete} /></div>}

          <footer className="page-footer"><span><span className="footer-dot" /> Çalışkanlar Yapı Market · Ortak cari defteri</span><span>Bugün: {formatDate(todayIso())}</span></footer>
        </div>
      </main>

      {selected && <CustomerDetail customer={selected} entries={selectedEntries} onClose={() => setSelectedId(null)} onEdit={() => setDialog({ customerEdit: selected.id })} onMovement={(type) => setDialog({ movement: type, customerId: selected.id })} onDue={() => setDialog('due')} onArchive={() => { const restoring = Boolean(selected.archivedAt); const verb = restoring ? 'arşivden geri yüklensin' : 'aktif cari listesinden arşivlensin'; if (window.confirm(`${selected.name} ${verb} mi? Cari ve hareket geçmişi korunur; değişiklik diğer cihazlarda da görünür.`)) void handleArchive(selected, restoring ? false : true).catch(() => showToast(restoring ? 'Cari geri yüklenemedi. Firestore kurallarını kontrol edin.' : 'Cari arşivlenemedi. Firestore kurallarını kontrol edin.')); }} />}
      {dialog === 'customer' && <CustomerDialog onClose={() => setDialog(null)} onSubmit={handleCustomer} />}
      {typeof dialog === 'object' && dialog !== null && 'customerEdit' in dialog && selected && selected.id === dialog.customerEdit && <CustomerEditDialog key={dialog.customerEdit} customer={selected} onClose={() => setDialog(null)} onSubmit={handleCustomerProfileUpdate} />}
      {typeof dialog === 'object' && dialog !== null && 'movement' in dialog && <MovementDialog key={`${dialog.movement}-${dialog.customerId ?? 'new'}`} type={dialog.movement} customers={customers} inventoryProducts={stockProducts.filter((product) => product.active)} initialCustomerId={dialog.customerId} onClose={() => setDialog(null)} onSubmit={handleMovement} />}
      {dialog === 'due' && selected && <DueDialog customer={selected} onClose={() => setDialog(null)} onSubmit={handleDueDate} />}
      {toast && <div className="toast"><span className="toast-check"><Check size={15} /></span>{toast}</div>}
    </div>
  );
}

function StatCard({ label, value, note, icon, tone }: { label: string; value: string; note: string; icon: ReactNode; tone: string }) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon ${tone}`}>{icon}</span></div><div className="stat-value">{value}</div><div className="stat-note">{note}</div><div className={`stat-foot ${tone}`}><span className="stat-footline" /><span>Güncel</span></div></div>;
}

function CustomerTable({ customers, onSelect, compact = false, dueView = false }: { customers: Customer[]; onSelect: (customer: Customer) => void; compact?: boolean; dueView?: boolean }) {
  if (!customers.length) return <div className="empty-state"><div className="empty-icon"><ListFilter size={20} /></div><strong>Gösterilecek cari bulunamadı</strong><span>Arama veya filtreleri değiştirip tekrar deneyin.</span></div>;
  return <div className={`table-scroll ${compact ? 'compact-table' : ''}`}><table><thead><tr><th>MÜŞTERİ / FİRMA</th>{!compact && <th>TELEFON</th>}<th>ÖDEME VADESİ</th><th className="align-right">KALAN BAKİYE</th><th>DURUM</th></tr></thead><tbody>{customers.map((customer) => {
    const state = dueState(customer);
    const StateIcon = state.icon;
    return <tr key={customer.id}>
      <td><button className="customer-cell" onClick={() => onSelect(customer)}><span className={`customer-avatar avatar-${(customer.name.charCodeAt(0) % 5) + 1}`}>{initials(customer.name)}</span><span className="customer-text"><strong>{customer.name}</strong><span>{customer.company || 'Bireysel müşteri'}</span></span></button></td>
      {!compact && <td className="phone-cell">{customer.phone || '—'}</td>}
      <td><span className="table-date">{customer.currentDueDate ? formatDate(customer.currentDueDate) : '—'}</span>{dueView && state.className === 'overdue' && <span className="date-subtext">Ödeme tarihi geçti</span>}</td>
      <td className="align-right"><span className={`balance-value ${customer.balance <= 0 ? 'zero' : ''}`}>{money(customer.balance)}</span></td>
      <td><span className={`status-badge ${state.className}`}><StateIcon size={13} />{state.label}</span></td>
    </tr>;
  })}</tbody></table></div>;
}

function ArchivedCustomers({ customers, onRestore, onView }: { customers: Customer[]; onRestore: (customer: Customer) => void; onView: (customer: Customer) => void }) {
  return <section className="panel archived-panel">
    <div className="panel-heading"><div><h2>Arşivlenen cariler <span className="count-pill">{customers.length}</span></h2><p>Arşivleme tüm cihazlarda eşitlenir. Cari ve hareket geçmişi silinmez.</p></div><span className="team-panel-mark"><Archive size={19} /></span></div>
    {!customers.length ? <div className="empty-state"><div className="empty-icon"><Archive size={20} /></div><strong>Arşivde cari yok</strong><span>Bir cari hesabı arşivlediğinizde geçmişi burada saklanır.</span></div> : <div className="archived-list">{customers.map((customer) => <div className="archived-row" key={customer.id}>
      <span className="customer-avatar avatar-2">{initials(customer.name)}</span>
      <button type="button" className="archived-customer-copy archived-customer-open" onClick={() => onView(customer)} aria-label={`${customer.name} arşiv kaydını ve hareket geçmişini aç`}><strong>{customer.name}</strong><span>{customer.company || 'Bireysel müşteri'}{customer.phone ? ` · ${customer.phone}` : ''}</span></button>
      <span className="archived-balance"><small>Kalan bakiye</small><strong>{money(customer.balance)}</strong></span>
      <span className="archived-date">{customer.archivedAt ? formatDate(customer.archivedAt.slice(0, 10)) : 'Arşivlendi'}</span>
      <button className="button button-outline restore-button" onClick={() => onRestore(customer)}><RotateCcw size={15} /> Geri yükle</button>
    </div>)}</div>}
  </section>;
}

function DueList({ customers, onSelect }: { customers: Customer[]; onSelect: (customer: Customer) => void }) {
  if (!customers.length) return <div className="due-empty"><div className="due-empty-mark"><BadgeCheck size={20} /></div><div><strong>Takip gerektiren vade yok</strong><span>Yeni bir vade yaklaştığında burada göreceksiniz.</span></div></div>;
  return <div className="due-list">{customers.map((customer) => {
    const state = dueState(customer);
    return <button className="due-item" key={customer.id} onClick={() => onSelect(customer)}><span className={`due-date-block ${state.className}`}><strong>{customer.currentDueDate ? new Intl.DateTimeFormat('tr-TR', { day: '2-digit' }).format(parseDate(customer.currentDueDate)!) : '—'}</strong><span>{customer.currentDueDate ? new Intl.DateTimeFormat('tr-TR', { month: 'short' }).format(parseDate(customer.currentDueDate)!) : '—'}</span></span><span className="due-item-copy"><strong>{customer.name}</strong><span>{state.label}</span></span><span className="due-item-amount">{money(customer.balance)}</span></button>;
  })}</div>;
}

function ActivityList({ entries, onSelect, large = false }: { entries: LedgerEntry[]; onSelect: (entry: LedgerEntry) => void; large?: boolean }) {
  if (!entries.length) return <div className="empty-state compact-empty"><div className="empty-icon"><Activity size={20} /></div><strong>Henüz hesap hareketi yok</strong><span>Borç veya tahsilat kaydı eklediğinizde burada görünür.</span></div>;
  return <div className={`activity-list ${large ? 'activity-list-large' : ''}`}>{entries.map((entry) => {
    const isPayment = entry.type === 'payment';
    const isDue = entry.type === 'due_update';
    const isSale = isProductSaleEntry(entry);
    const Icon = isPayment ? ArrowDownLeft : isDue ? CalendarClock : isSale ? ShoppingCart : ArrowUpRight;
    const vat = saleVatBreakdown(entry);
    const description = isSale
      ? `${entry.items?.length ? `${entry.items.length} ürün · ` : ''}Satış ${money(entry.amount)}${vat ? ` · KDV %${vat.vatRateBps / 100} dâhil` : ''}${entry.type === 'sale' ? ` · Tahsilat ${money(entry.paidNow ?? 0)}` : ''}${entry.note ? ` · ${entry.note}` : ''}`
      : `${activityTitle(entry.type, Boolean(entry.items?.length), entry.vatRateBps)}${entry.note && entry.type !== 'due_update' ? ` · ${entry.note}` : ''}`;
    const remainingAtSale = entry.remainingAtSale ?? (entry.type === 'sale' ? Math.max(0, entry.amount - (entry.paidNow ?? 0)) : entry.amount);
    const activityAmount = isSale
      ? entry.type === 'sale' ? (remainingAtSale > 0 ? `+${money(remainingAtSale)}` : 'Peşin') : `+${money(entry.amount)}`
      : isDue ? 'Vade değişikliği' : `${isPayment ? '−' : '+'}${money(entry.amount)}`;
    return <button className="activity-row" key={entry.id} onClick={() => onSelect(entry)}><span className={`activity-icon ${isPayment ? 'payment' : isDue ? 'due-change' : isSale ? 'sale' : 'debt'}`}><Icon size={16} /></span><span className="activity-main"><strong>{entry.customerName ?? 'Müşteri'}</strong><span>{description}</span></span><span className="activity-date">{formatDate(entry.date)}</span><span className={`activity-amount ${isPayment ? 'positive' : isDue ? 'neutral' : isSale ? 'sale' : 'negative'}`}>{activityAmount}</span><ArrowRight className="activity-chevron" size={15} /></button>;
  })}</div>;
}

function CustomerDetail({ customer, entries, onClose, onEdit, onMovement, onDue, onArchive }: { customer: Customer; entries: LedgerEntry[]; onClose: () => void; onEdit: () => void; onMovement: (type: 'debt' | 'payment') => void; onDue: () => void; onArchive: () => void }) {
  const [printMode, setPrintMode] = useState<CustomerPrintMode | null>(null);
  const [pdfBusy, setPdfBusy] = useState(false);
  const [preparedPdf, setPreparedPdf] = useState<PreparedStatementPdf | null>(null);
  const [pdfNotice, setPdfNotice] = useState('');
  const [pdfError, setPdfError] = useState('');
  const state = dueState(customer);
  const archived = Boolean(customer.archivedAt);
  const whatsappUrl = createWhatsAppReminderUrl(customer);
  const whatsappMessage = createWhatsAppReminderMessage(customer);
  const sales = entries.filter(isProductSaleEntry).sort((left, right) => right.date.localeCompare(left.date));
  const canPrintStatement = customer.balance > 0 || entries.some((entry) => entry.type === 'sale' || entry.type === 'debt' || entry.type === 'payment' || entry.type === 'due_update');

  async function prepareStatementPdf(): Promise<PreparedStatementPdf | null> {
    if (pdfBusy || !whatsappUrl || !whatsappMessage) return null;
    setPdfBusy(true);
    setPreparedPdf(null);
    setPdfNotice('');
    setPdfError('');
    try {
      const file = await createCustomerStatementPdf(customer, entries);
      let supportsFileShare = false;
      try {
        supportsFileShare = typeof navigator.share === 'function'
          && typeof navigator.canShare === 'function'
          && navigator.canShare({ files: [file] });
      } catch { /* Bu tarayıcıda PDF dosyası paylaşımını desteklemiyor. */ }
      const prepared = { file, whatsappUrl, message: whatsappMessage, supportsFileShare };
      setPreparedPdf(prepared);
      setPdfNotice(supportsFileShare
        ? 'PDF hazır. Paylaşım menüsünü açıp WhatsApp’ı seçin; alıcıyı ve mesajı kontrol ederek gönderin.'
        : 'PDF hazır. Önce PDF’i indirin, sonra WhatsApp Web’de dosyayı sohbete ekleyip gönderin.');
      return prepared;
    } catch (error) {
      setPdfError(error instanceof Error ? error.message : 'Cari ekstresi PDF olarak hazırlanamadı.');
      return null;
    } finally {
      setPdfBusy(false);
    }
  }

  function supportsPdfFileShare() {
    if (typeof File === 'undefined' || typeof navigator.share !== 'function' || typeof navigator.canShare !== 'function') return false;
    try {
      const probe = new File([''], 'cari-ekstresi.pdf', { type: 'application/pdf' });
      return navigator.canShare({ files: [probe] });
    } catch { return false; }
  }

  async function shareStatementFile(prepared: PreparedStatementPdf) {
    if (!prepared.supportsFileShare || typeof navigator.share !== 'function') return;
    setPdfError('');
    try {
      await navigator.share({
        title: `${customer.name} · Cari Ekstresi`,
        text: prepared.message,
        files: [prepared.file],
      });
      setPdfNotice('Paylaşım menüsü açıldı. WhatsApp’ı seçip alıcıyı ve mesajı kontrol ederek Gönder’e basın.');
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        setPdfNotice('Paylaşım iptal edildi. PDF hazır; tekrar deneyebilir veya indirebilirsiniz.');
      } else {
        setPdfError('PDF hazır ancak paylaşım menüsü açılamadı. Aşağıdaki paylaşım düğmesini tekrar deneyin veya PDF’i indirip WhatsApp’a ekleyin.');
      }
    }
  }

  async function shareStatementToWhatsApp() {
    if (pdfBusy || !whatsappUrl || !whatsappMessage) return;
    setPdfError('');
    const nativeFileShareAvailable = preparedPdf?.supportsFileShare ?? supportsPdfFileShare();
    let whatsappWindow: Window | null = null;
    if (!nativeFileShareAvailable) {
      try {
        whatsappWindow = window.open('about:blank', '_blank');
        if (whatsappWindow) whatsappWindow.opener = null;
      } catch { /* Açılır pencere engellenirse sohbet bağlantısı PDF bölümünde kalır. */ }
    }

    const prepared = preparedPdf ?? await prepareStatementPdf();
    if (!prepared) {
      whatsappWindow?.close();
      return;
    }
    if (prepared.supportsFileShare && typeof navigator.share === 'function') {
      whatsappWindow?.close();
      await shareStatementFile(prepared);
      return;
    }

    downloadPdfFile(prepared.file);
    if (whatsappWindow) {
      try { whatsappWindow.location.replace(prepared.whatsappUrl); }
      catch { whatsappWindow.location.href = prepared.whatsappUrl; }
    }
    setPdfNotice(whatsappWindow
      ? 'Ekstre PDF indirildi ve WhatsApp mesaj taslağı açıldı. PDF’i sohbete ekleyip Gönder’e basın.'
      : 'Ekstre PDF indirildi. WhatsApp sohbetini açıp dosyayı ekleyerek Gönder’e basın.');
  }

  async function sharePreparedStatement() {
    if (!preparedPdf) return;
    await shareStatementFile(preparedPdf);
  }

  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="detail-drawer" role="dialog" aria-modal="true" aria-labelledby="detail-title">
        <div className="drawer-header">
          <div><span className="eyebrow">{archived ? 'ARŞİVLENMİŞ CARİ' : 'CARİ HESAP DETAYI'}</span><button className="icon-button drawer-close" onClick={onClose} aria-label="Kapat"><X size={18} /></button></div>
          <div className="detail-person"><span className="customer-avatar avatar-3 large-avatar">{initials(customer.name)}</span><div><h2 id="detail-title">{customer.name}</h2><span>{customer.company || 'Bireysel müşteri'}{customer.phone ? ` · ${customer.phone}` : ''}</span></div></div>
          <button type="button" className="button button-outline customer-profile-edit" onClick={onEdit}><Pencil size={14} /> Bilgileri düzenle</button>
        </div>
        <div className="detail-balance"><div><span>Güncel kalan bakiye</span><strong>{money(customer.balance)}</strong></div><span className={`status-badge ${state.className}`}><state.icon size={13} />{state.label}</span></div>
        <div className="detail-mini-stats"><div><span>Toplam borç</span><strong>{money(customer.totalDebt)}</strong></div><div><span>Toplam tahsilat</span><strong>{money(customer.totalPaid)}</strong></div></div>
        {!archived && <div className="detail-actions"><button className="button button-primary" onClick={() => onMovement('debt')}><ShoppingCart size={16} /> Satış</button><button className="button button-outline" onClick={() => onMovement('payment')}><Banknote size={16} /> Tahsilat al</button></div>}
        {customer.balance > 0 && (whatsappUrl
          ? <>
              <button type="button" className="button whatsapp-send-button" onClick={() => void shareStatementToWhatsApp()} disabled={pdfBusy}>
                {pdfBusy ? <LoaderCircle className="whatsapp-pdf-spinner" size={16} /> : <Share2 size={16} />}
                {pdfBusy ? 'Ekstre PDF hazırlanıyor…' : 'WhatsApp’a PDF’li borç hatırlatması gönder'}
              </button>
              <div className="whatsapp-pdf-panel">
              <p className="whatsapp-pdf-help">Tek düğmeyle A4 ekstre PDF’i hazırlanır; borç tutarı ve vade bilgisi hazır mesaja eklenir. Telefonda paylaşım menüsünden WhatsApp’ı seçin; bilgisayarda indirilen PDF’i açılan mesaj taslağına ekleyin. Gönderimi WhatsApp’ta siz tamamlarsınız.</p>
              {pdfNotice && <p className="whatsapp-pdf-status" role="status">{pdfNotice}</p>}
              {pdfError && <p className="whatsapp-pdf-error" role="alert">{pdfError}</p>}
              {preparedPdf && <div className="whatsapp-pdf-actions">
                {preparedPdf.supportsFileShare
                  ? <button type="button" className="button button-outline" onClick={() => void sharePreparedStatement()}><Share2 size={15} /> Paylaşım menüsünü aç</button>
                  : <a className="button button-outline" href={preparedPdf.whatsappUrl} target="_blank" rel="noopener noreferrer"><MessageCircle size={15} /> WhatsApp sohbetini aç</a>}
                <button type="button" className="button button-outline" onClick={() => downloadPdfFile(preparedPdf.file)}><Download size={15} /> PDF’i indir</button>
              </div>}
            </div>
            </>
          : <p className="whatsapp-phone-note">WhatsApp hatırlatması için müşteri kartına geçerli telefon numarası ekleyin.</p>)}
        {!archived && <div className="due-edit-row"><div className="due-edit-icon"><CalendarClock size={17} /></div><div><span>Ödeme vadesi</span><strong>{customer.currentDueDate ? formatDate(customer.currentDueDate) : 'Henüz belirlenmedi'}</strong></div><button className="text-button" onClick={onDue}>Vadeyi düzenle <ArrowRight size={14} /></button></div>}
        <section className="customer-sales-section">
          <div className="customer-sales-heading"><div><h3>Satış geçmişi</h3><span>{sales.length} satış · ürün, fiyat ve KDV özeti</span></div><button className="button button-outline customer-print-button" onClick={() => setPrintMode({ kind: 'statement' })} disabled={!canPrintStatement}><Printer size={15} /> Ekstreyi yazdır / PDF</button></div>
          {sales.length ? <div className="customer-sales-list">{sales.map((sale) => {
            const paidNow = sale.paidNow ?? 0;
            const remaining = sale.remainingAtSale ?? (sale.type === 'sale' ? Math.max(0, sale.amount - paidNow) : sale.amount);
            const vat = saleVatBreakdown(sale);
            return <article className="customer-sale-card" key={sale.id}>
              <header><div><strong>{formatDate(sale.date)}</strong><span>{sale.items?.length ? `${sale.items.length} ürün · ` : 'Manuel satış · '}{money(sale.amount)}{vat ? ` · KDV %${vat.vatRateBps / 100} dâhil` : ''}</span></div><button type="button" className="sale-print-icon" onClick={() => setPrintMode({ kind: 'sale', saleId: sale.id })} aria-label={`${formatDate(sale.date)} 80×80 mm satış fişini yazdır`}><Printer size={15} /></button></header>
              <div className="customer-sale-items">{(sale.items ?? []).map((item, index) => <div key={`${sale.id}-${index}`}><span><strong>{item.name}</strong><small>{formatQuantity(saleItemQuantity(item))} {item.unit} × {money(saleItemUnitPrice(item))} · KDV dâhil</small></span><strong>{money(saleItemLineTotal(item))}</strong></div>)}{!sale.items?.length && <p className="customer-sale-no-items">Bu kayıtta ürün satırı bulunmuyor.</p>}</div>
              {vat && <div className="customer-sale-tax"><span>Matrah <strong>{money(vat.vatBaseCents / 100)}</strong></span><span>KDV %20 <strong>{money(vat.vatCents / 100)}</strong></span><span>Brüt <strong>{money(vat.grossCents / 100)}</strong></span></div>}
              <footer><span>{sale.type === 'sale' ? 'Tahsil edildi' : 'Cari borca eklendi'} <strong>{sale.type === 'sale' ? `${money(paidNow)}${sale.paymentMethod ? ` · ${paymentMethodLabel(sale.paymentMethod)}` : ''}` : money(remaining)}</strong></span><span>Satışta kalan <strong>{money(remaining)}</strong></span></footer>
            </article>;
          })}</div> : <div className="customer-sales-empty">Henüz ürün detaylı satış yok. Yeni satış eklediğinizde ürünler ve fiyatları burada listelenir.</div>}
        </section>
        <div className="ledger-heading"><div><h3>Cari hareketleri</h3><span>{entries.length} kayıt · en yeniden eskiye</span></div></div>
        <div className="ledger-list">{entries.length ? entries.map((entry) => {
          const productSale = isProductSaleEntry(entry);
          const remaining = entry.remainingAtSale ?? (entry.type === 'sale' ? Math.max(0, entry.amount - (entry.paidNow ?? 0)) : entry.amount);
          const amountLabel = entry.type === 'due_update' ? '' : productSale ? (remaining > 0 ? `+${money(remaining)}` : 'Peşin') : `${entry.type === 'payment' ? '−' : '+'}${money(entry.amount)}`;
          return <div className="ledger-entry" key={entry.id}><span className={`ledger-dot ${productSale ? 'sale' : entry.type}`} /> <div className="ledger-entry-copy"><strong>{activityTitle(entry.type, Boolean(entry.items?.length), entry.vatRateBps)}</strong><span>{formatDate(entry.date)}{entry.note ? ` · ${entry.note}` : ''}{productSale && entry.items?.length ? ` · ${entry.items.length} ürün` : productSale ? ' · KDV %20 dâhil' : ''}</span>{entry.type === 'due_update' && <span className="ledger-due-change">{entry.previousDueDate ? formatDate(entry.previousDueDate) : 'Vade yok'} <ArrowRight size={12} /> {formatDate(entry.nextDueDate)}</span>}</div><strong className={`ledger-amount ${productSale ? 'sale' : entry.type}`}>{amountLabel}</strong></div>;
        }) : <div className="ledger-empty">Bu cariye henüz hareket kaydı eklenmemiş.</div>}</div>
        {customer.note && <div className="detail-note"><strong>Not</strong><p>{customer.note}</p></div>}
        <div className="archive-action-wrap">
          <p>{archived ? 'Kayıt ve hareket geçmişi korunur; geri yüklendiğinde tüm cihazlardaki aktif listeye döner.' : 'Müşteri ve hareket geçmişi korunur; bu cari tüm cihazlardaki aktif listeden kaldırılır.'}</p>
          <button className="button button-outline archive-customer-action" onClick={onArchive}>{archived ? <RotateCcw size={15} /> : <Archive size={15} />}{archived ? 'Arşivden geri yükle' : 'Cariyi arşivle'}</button>
        </div>
      </section>
      {printMode && <CustomerPrint customer={customer} entries={entries} mode={printMode} onDone={() => setPrintMode(null)} />}
    </div>
  );
}

function Modal({ title, subtitle, onClose, children }: { title: string; subtitle: string; onClose: () => void; children: ReactNode }) {
  return <div className="overlay modal-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal-card" role="dialog" aria-modal="true"><header className="modal-header"><div><span className="eyebrow">ÇALIŞKANLAR YAPI MARKET</span><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={onClose} aria-label="Pencereyi kapat"><X size={18} /></button></header>{children}</section></div>;
}

function CustomerDialog({ onClose, onSubmit }: { onClose: () => void; onSubmit: (data: Pick<Customer, 'name' | 'phone' | 'company' | 'note'>) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [phone, setPhone] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    const form = new FormData(event.currentTarget);
    try { await onSubmit({ name: String(form.get('name') ?? '').trim(), phone: phone.trim(), company: String(form.get('company') ?? '').trim(), note: String(form.get('note') ?? '').trim() }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Kayıt oluşturulamadı.'); }
    finally { setBusy(false); }
  }
  return <Modal title="Yeni cari hesap" subtitle="Müşteri bilgilerini ekleyerek hesabı oluşturmaya başlayın." onClose={onClose}><form className="form-stack" onSubmit={submit}><label className="field"><span>Müşteri adı <i>*</i></span><input name="name" placeholder="Örn. Ahmet Yılmaz" required maxLength={120} autoFocus /></label><div className="field-row"><label className="field"><span>Firma / işletme</span><input name="company" placeholder="Örn. Yılmaz İnşaat" maxLength={120} /></label><label className="field"><span>Telefon</span><input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="05xx xxx xx xx" value={phone} onChange={(event) => applyInputFormatter(event.currentTarget, formatTurkishPhoneInputWithCaret, setPhone)} maxLength={24} /></label></div><label className="field"><span>Hesap notu</span><textarea name="note" placeholder="Teslimat, iletişim veya hesapla ilgili not…" rows={3} maxLength={500} /></label>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Vazgeç</button><button className="button button-primary" disabled={busy}>{busy ? 'Kaydediliyor…' : <><Plus size={16} /> Cariyi oluştur</>}</button></div></form></Modal>;
}

function CustomerEditDialog({ customer, onClose, onSubmit }: { customer: Customer; onClose: () => void; onSubmit: (customerId: string, data: Pick<Customer, 'name' | 'phone'>) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [phone, setPhone] = useState(() => customer.phone ? formatTurkishPhoneInputWithCaret(customer.phone, customer.phone.length).value : '');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await onSubmit(customer.id, {
        name: String(form.get('name') ?? '').trim(),
        phone: phone.trim(),
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Müşteri bilgileri güncellenemedi.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Müşteri bilgilerini düzenle" subtitle="Cari bakiyesi, vadesi ve hareket geçmişi değişmeden kalır." onClose={onClose}>
      <form className="form-stack" onSubmit={submit}>
        <label className="field"><span>Müşteri adı <i>*</i></span><input name="name" defaultValue={customer.name} required maxLength={120} autoFocus /></label>
        <label className="field"><span>Telefon numarası</span><input name="phone" type="tel" inputMode="tel" autoComplete="tel" placeholder="05xx xxx xx xx" value={phone} onChange={(event) => applyInputFormatter(event.currentTarget, formatTurkishPhoneInputWithCaret, setPhone)} maxLength={24} /></label>
        <small className="profile-edit-help">Ad ve telefon ortak cari defterinde tüm cihazlarda güncellenir. Önceki hareket kayıtları korunur.</small>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose} disabled={busy}>Vazgeç</button><button className="button button-primary" disabled={busy}>{busy ? 'Güncelleniyor…' : <><Check size={16} /> Bilgileri kaydet</>}</button></div>
      </form>
    </Modal>
  );
}

function MovementDialog({ type, customers, inventoryProducts, initialCustomerId, onClose, onSubmit }: { type: 'debt' | 'payment'; customers: Customer[]; inventoryProducts: InventoryProduct[]; initialCustomerId?: string; onClose: () => void; onSubmit: (customer: Customer, type: 'debt' | 'payment', amount: number, date: string, note: string, dueDate: string, items?: SaleItemInput[]) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [customerId, setCustomerId] = useState(initialCustomerId ?? customers[0]?.id ?? '');
  const [amountText, setAmountText] = useState('');
  const [productRows, setProductRows] = useState<ProductDraft[]>([]);
  const activeInventoryProducts = inventoryProducts.filter((item) => item.active);
  const customer = customers.find((item) => item.id === customerId);
  const isPayment = type === 'payment';
  const calculatedRows = useMemo(() => productRows.map((row) => {
    const quantityMilli = parseQuantityMilli(row.quantity);
    const unitPrice = parseMoneyInput(row.unitPrice);
    const unitPriceCents = unitPrice === null ? null : Math.round(unitPrice * 100);
    const lineCents = quantityMilli !== null && unitPriceCents !== null
      ? saleLineTotalCents(unitPriceCents, quantityMilli)
      : null;
    return { ...row, quantityMilli, unitPriceCents, lineCents };
  }), [productRows]);
  const hasProducts = !isPayment && productRows.length > 0;
  const allProductsValid = calculatedRows.every((row) => row.name.trim().length > 0
    && row.name.trim().length <= 120
    && row.unit.trim().length > 0
    && row.unit.trim().length <= 24
    && row.quantityMilli !== null
    && row.unitPriceCents !== null
    && row.lineCents !== null);
  const totalCents = calculatedRows.reduce((sum, row) => sum + (row.lineCents ?? 0), 0);
  const parsedAmount = hasProducts ? (allProductsValid ? totalCents / 100 : null) : parseMoneyInput(amountText);
  const exceedsBalance = Boolean(isPayment && customer && parsedAmount !== null && parsedAmount > customer.balance);
  const projectedBalance = customer
    ? customer.balance + (isPayment ? -(parsedAmount ?? 0) : (parsedAmount ?? 0))
    : 0;

  function updateProductRow(id: string, patch: Partial<ProductDraft>) {
    setProductRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
    if (error) setError('');
  }

  function addCatalogProduct(productId: string) {
    if (!productId) return;
    if (productRows.length >= 25) { setError('Bir satışta en fazla 25 ürün satırı eklenebilir.'); return; }
    const product = activeInventoryProducts.find((item) => item.id === productId && item.stockQuantityMilli > 0);
    if (!product) { setError('Seçilen ürünün kullanılabilir stoğu yok.'); return; }
    setProductRows((current) => [...current, {
      id: crypto.randomUUID(),
      productId: product.id,
      name: product.name,
      quantity: '1',
      unit: product.unit,
      unitPrice: formatMoneyInput((product.salePriceCents / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
    }]);
    setError('');
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    if (!customer) { setError('Önce bir cari hesap oluşturun.'); return; }
    if (hasProducts && !allProductsValid) { setError('Ürün adını, miktarı, birimi ve birim fiyatını kontrol edin.'); return; }
    const form = new FormData(event.currentTarget);
    const amount = hasProducts ? totalCents / 100 : parseMoneyInput(String(form.get('amount') ?? ''));
    if (amount === null) { setError('Tutarı TL olarak girin. Örnek: 1.250,50 (en fazla iki kuruş hanesi).'); return; }
    if (amount <= 0) { setError('Tutar sıfırdan büyük olmalıdır.'); return; }
    if (isPayment && amount > customer.balance) { setError(`Tahsilat kalan bakiyeyi (${money(customer.balance)}) aşamaz.`); return; }
    const items: SaleItemInput[] | undefined = hasProducts ? calculatedRows.map((row) => ({
      name: row.name.trim(),
      quantity: row.quantityMilli! / 1000,
      unit: row.unit.trim(),
      unitPrice: row.unitPriceCents! / 100,
      lineTotal: row.lineCents! / 100,
      ...(row.productId ? { productId: row.productId } : {}),
    })) : undefined;
    setBusy(true);
    try { await onSubmit(customer, type, amount, String(form.get('date') ?? todayIso()), String(form.get('note') ?? '').trim(), String(form.get('dueDate') ?? ''), items); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Hareket kaydedilemedi.'); }
    finally { setBusy(false); }
  }

  return (
    <Modal
      title={isPayment ? 'Tahsilat kaydet' : 'Satış kaydet'}
      subtitle={isPayment ? 'Alınan ödemeyi müşteri cari hesabına işleyin.' : 'Fiyatları KDV dâhil girin; %20 KDV ayrıştırılır, cari satış toplamı değişmez.'}
      onClose={onClose}
    >
      <form className="form-stack" onSubmit={submit}>
        <label className="field">
          <span>Müşteri <i>*</i></span>
          <select name="customer" value={customerId} onChange={(event) => setCustomerId(event.target.value)} required>
            <option value="" disabled>Müşteri seçin</option>
            {customers.map((item) => <option key={item.id} value={item.id}>{item.name} · {money(item.balance)} bakiye</option>)}
          </select>
        </label>
        {customer && (
          <div className={`selected-customer-note ${exceedsBalance ? 'is-over-balance' : ''}`}>
            <span>{isPayment ? 'Tahsilat sonrası kalan bakiye' : 'Satış sonrası kalan bakiye'}</span>
            <strong>{money(isPayment ? Math.max(0, projectedBalance) : projectedBalance)}</strong>
            {exceedsBalance && <small className="money-input-warning">Tahsilat kalan borcu aşamaz.</small>}
          </div>
        )}
        {!isPayment && <section className="sale-products-editor" aria-label="Satış ürünleri">
          <div className="sale-section-heading"><div><strong>Ürün satırları <span>(isteğe bağlı)</span></strong><small>Stoktan seçilen ürünlerin miktarı satışta düşer. Birim fiyatları KDV dâhildir.</small></div><span className="sale-item-count">{productRows.length}/25</span></div>
          {activeInventoryProducts.length > 0 && <label className="field inventory-sale-fast-add"><span>Stoktan hızlı ürün seç</span><select aria-label="Cari satışa stoktan hızlı ürün ekle" value="" onChange={(event) => addCatalogProduct(event.target.value)} disabled={productRows.length >= 25}><option value="">Ürün seçin; satıra doğrudan eklensin…</option>{activeInventoryProducts.map((item) => <option key={item.id} value={item.id} disabled={item.stockQuantityMilli <= 0}>{item.name} · {money(item.salePriceCents / 100)} · stok {formatQuantity(item.stockQuantityMilli / 1000)} {item.unit}{item.stockQuantityMilli <= 0 ? ' · Tükendi' : ''}</option>)}</select><small>Seçilen ürün adı, birimi ve fiyatı otomatik doldurulur; miktarı satırda düzenleyin.</small></label>}
          {calculatedRows.length > 0 && <div className="sale-rows">{calculatedRows.map((row, index) => <div className="sale-row" key={row.id}>
            <div className="sale-row-title"><strong>Ürün {index + 1}</strong><button type="button" className="sale-remove-row" onClick={() => { setProductRows((current) => current.filter((item) => item.id !== row.id)); setError(''); }} aria-label={`Ürün ${index + 1} satırını sil`}><Trash2 size={14} /></button></div>
            <label className="field inventory-sale-select"><span>Stok kataloğundan seç</span><select value={row.productId} onChange={(event) => {
              const selectedProduct = activeInventoryProducts.find((item) => item.id === event.target.value);
              updateProductRow(row.id, selectedProduct ? {
                productId: selectedProduct.id,
                name: selectedProduct.name,
                unit: selectedProduct.unit,
                unitPrice: formatMoneyInput((selectedProduct.salePriceCents / 100).toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
              } : { productId: '' });
            }}><option value="">Manuel ürün — stoktan düşme</option>{activeInventoryProducts.map((item) => <option key={item.id} value={item.id} disabled={item.stockQuantityMilli <= 0}>{item.name} · {formatQuantity(item.stockQuantityMilli / 1000)} {item.unit} stok · {money(item.salePriceCents / 100)}{item.stockQuantityMilli <= 0 ? ' · Tükendi' : ''}</option>)}</select><small>{activeInventoryProducts.length ? 'Stok ürünü seçildiğinde ürün bilgileri katalogdan gelir.' : 'Stoktan satış için önce Stok Takibi bölümüne aktif ürün ekleyin.'}</small></label>
            <label className="field sale-name-field"><span>Ürün adı <i>*</i></span><input value={row.name} onChange={(event) => updateProductRow(row.id, { productId: '', name: event.target.value })} placeholder="Örn. Seramik yapıştırıcısı" maxLength={120} required disabled={Boolean(row.productId)} /></label>
            <div className="sale-row-grid">
              <label className="field"><span>Miktar <i>*</i></span><input value={row.quantity} onChange={(event) => updateProductRow(row.id, { quantity: event.target.value })} inputMode="decimal" placeholder="1,5" maxLength={16} required /><small>En fazla 3 ondalık hane.</small></label>
              <label className="field"><span>Birim <i>*</i></span><input value={row.unit} onChange={(event) => updateProductRow(row.id, { productId: '', unit: event.target.value })} placeholder="adet, kg, m…" maxLength={24} required disabled={Boolean(row.productId)} /></label>
              <label className="field"><span>Birim fiyatı <i>*</i></span><div className="input-with-suffix"><input value={row.unitPrice} onChange={(event) => applyInputFormatter(event.currentTarget, formatMoneyInputWithCaret, (value) => updateProductRow(row.id, { productId: '', unitPrice: value }))} inputMode="decimal" placeholder="0,00" maxLength={24} required disabled={Boolean(row.productId)} /><span>TL</span></div></label>
              <div className="sale-line-total"><span>Satır toplamı</span><strong>{row.lineCents === null ? '—' : money(row.lineCents / 100)}</strong></div>
            </div>
          </div>)}</div>}
          <button type="button" className="button button-outline sale-add-row" onClick={() => { if (productRows.length < 25) setProductRows((current) => [...current, makeProductDraft()]); setError(''); }} disabled={productRows.length >= 25}><Plus size={15} /> Ürün satırı ekle</button>
          {hasProducts && <div className="sale-total-card"><span>Satış toplamı · KDV dâhil</span><strong>{money(totalCents / 100)}</strong></div>}
        </section>}
        <div className="field-row">
          {!hasProducts && <label className="field">
            <span>{isPayment ? 'Tahsilat tutarı' : 'Satış tutarı · KDV dâhil'} <i>*</i></span>
            <div className="input-with-suffix">
              <input name="amount" type="text" inputMode="decimal" autoComplete="off" maxLength={24} placeholder="Örn. 1.250 veya 1.250,50" value={amountText} onFocus={(event) => applyInputFormatter(event.currentTarget, ungroupMoneyInputWithCaret, setAmountText)} onChange={(event) => { applyInputFormatter(event.currentTarget, formatMoneyInputWithCaret, setAmountText); if (error) setError(''); }} onBlur={(event) => setAmountText(formatMoneyInput(event.currentTarget.value))} aria-describedby="amount-format-help" required />
              <span>TL</span>
            </div>
            <small id="amount-format-help" className="money-input-help">Binlik noktaları yazarken otomatik eklenir. Kuruş için virgül kullanın (örn. 1.250,50).</small>
          </label>}
          <label className="field">
            <span>İşlem tarihi <i>*</i></span>
            <input name="date" type="date" defaultValue={todayIso()} required />
          </label>
        </div>
        {!isPayment && (
          <label className="field">
            <span>Ödeme vadesi</span>
            <input name="dueDate" key={customerId} type="date" defaultValue={customer?.currentDueDate ?? ''} />
            <small>Bu tarih, müşterinin güncel cari vadesi olarak kaydedilir.</small>
          </label>
        )}
        <label className="field">
          <span>Açıklama</span>
          <input name="note" placeholder={isPayment ? 'Örn. Havale, nakit, kart' : 'Örn. Şantiye teslimatı'} maxLength={180} />
        </label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button type="button" className="button button-outline" onClick={onClose}>Vazgeç</button>
          <button className={`button ${isPayment ? 'button-primary' : 'button-dark'}`} disabled={busy || customers.length === 0 || !customer || (hasProducts ? !allProductsValid || totalCents <= 0 : parsedAmount === null || parsedAmount <= 0) || exceedsBalance}>
            {busy ? 'Kaydediliyor…' : <>{isPayment ? <Banknote size={16} /> : <ShoppingCart size={16} />}{isPayment ? ' Tahsilatı kaydet' : ' Satışı kaydet'}</>}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function DueDialog({ customer, onClose, onSubmit }: { customer: Customer; onClose: () => void; onSubmit: (customer: Customer, date: string) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const date = String(form.get('dueDate') ?? '');
    if (!date) { setError('Yeni vade tarihini seçin.'); return; }
    setBusy(true); setError('');
    try { await onSubmit(customer, date); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Vade güncellenemedi.'); }
    finally { setBusy(false); }
  }
  return <Modal title="Ödeme vadesini güncelle" subtitle={`${customer.name} · mevcut açık bakiye ${money(customer.balance)}`} onClose={onClose}><form className="form-stack" onSubmit={submit}><div className="due-callout"><CalendarClock size={18} /><span>Bu vade, müşterinin cari hesap özetindeki güncel ödeme tarihi olarak kullanılacaktır.</span></div><label className="field"><span>Yeni vade tarihi <i>*</i></span><input type="date" name="dueDate" defaultValue={customer.currentDueDate || dateOffset(7)} required autoFocus /></label>{error && <div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-outline" onClick={onClose}>Vazgeç</button><button className="button button-primary" disabled={busy}>{busy ? 'Güncelleniyor…' : <><CalendarClock size={16} /> Vadeyi güncelle</>}</button></div></form></Modal>;
}

function FirebaseSetup() {
  return <section className="setup-card" id="firebase-setup"><div className="setup-number">01</div><div className="setup-copy"><span className="eyebrow">CANLI KULLANIMA GEÇİŞ</span><h2>Ortak cari defterini yapılandırın</h2><p>Demo kayıtları yalnızca bu tarayıcıda saklanır. Canlı kullanımda aynı cari verileri çalışanlar arasında Firebase üzerinden eşitlenir.</p></div><div className="setup-steps"><span><i>1</i> Firebase e-posta/şifre girişini aç</span><span><i>2</i> İşletme sahibinin UID'sini Netlify'a ekle</span><span><i>3</i> Üyelik güvenlik kurallarını yayımla</span></div></section>;
}

function WorkspaceSetup({ theme, onToggleTheme }: { theme: ThemeMode; onToggleTheme: () => void }) {
  const projectId = import.meta.env.VITE_FIREBASE_PROJECT_ID;
  const consoleUrl = projectId ? `https://console.firebase.google.com/project/${encodeURIComponent(projectId)}/authentication/users` : 'https://console.firebase.google.com/';
  return <main className="workspace-setup-screen"><ThemeToggle theme={theme} onToggle={onToggleTheme} className="auth-theme-toggle" /><section className="workspace-setup-card"><div className="auth-brand"><span className="auth-brand-symbol"><img src="/cari-usta-logo.svg" alt="" /></span><span><strong>Çalışkanlar</strong><small>YAPI MARKET</small></span></div><span className="eyebrow">GÜVENLİ KURULUM</span><h1>Ortak cari alanı henüz tanımlı değil.</h1><p>Mevcut işletme sahibi hesabının Firebase UID'si Netlify build ortamındaki <code>VITE_CARI_OWNER_UID</code> değişkenine eklenmeli. Böylece eski cari kayıtları aynı UID altında korunur.</p><a className="button button-primary" href={consoleUrl} target="_blank" rel="noreferrer">Firebase Authentication kullanıcılarını aç <ArrowRight size={16} /></a><div className="auth-footnote"><LockKeyhole size={14} /> UID bir public tanımlayıcıdır; cari güvenliği Firestore kurallarıyla sağlanır.</div></section></main>;
}

function AuthScreen({ onSubmit, error, busy, theme, onToggleTheme }: { onSubmit: (event: FormEvent<HTMLFormElement>) => void; error: string; busy: boolean; theme: ThemeMode; onToggleTheme: () => void }) {
  return <main className="auth-screen">
    <ThemeToggle theme={theme} onToggle={onToggleTheme} className="auth-theme-toggle" />
    <section className="auth-brand-panel"><div className="auth-brand"><span className="auth-brand-symbol"><img src="/cari-usta-logo.svg" alt="" /></span><span><strong>Çalışkanlar</strong><small>YAPI MARKET</small></span></div><div className="auth-brand-message"><span className="auth-red-rule" /><p>SAĞLAM TİCARET.<br /><strong>GÜVENLİ CARİ TAKİBİ.</strong></p><span className="auth-brand-sub">Aynı cari defteri, her cihazda güncel.</span></div><div className="auth-panel-foot">Çalışkanlar Yapı Market <span>·</span> Cari yönetimi</div></section>
    <section className="auth-card"><span className="eyebrow auth-eyebrow">İŞLETME HESABI</span><h1>Giriş yapın<span className="heading-period">.</span></h1><p className="auth-intro">Yönetici tarafından oluşturulan e-posta ve şifrenizle devam edin.</p>
      <form className="form-stack auth-form" onSubmit={onSubmit}>
        <label className="field"><span>E-posta adresi</span><input type="email" name="email" placeholder="adiniz@ornek.com" autoComplete="username" required autoFocus /></label>
        <label className="field"><span>Şifre</span><input type="password" name="password" placeholder="Şifrenizi girin" autoComplete="current-password" required /></label>
        {error && <div className="form-error" role="alert">{error}</div>}
        <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Giriş yapılıyor…' : 'Giriş yap'}<ArrowRight size={16} /></button>
      </form>
      <div className="auth-footnote"><LockKeyhole size={14} /> Hesap oluşturma yalnızca işletme yöneticisi tarafından yapılır.</div>
    </section>
  </main>;
}

export default App;
