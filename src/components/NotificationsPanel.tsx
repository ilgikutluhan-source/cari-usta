import { AlertCircle, ArrowDownLeft, CalendarClock, Clock3, X } from 'lucide-react';
import { formatDate, money, type Customer, type LedgerEntry } from '../models';

export type DueReminder = {
  customer: Customer;
  status: 'overdue' | 'soon';
  statusLabel: string;
};

export type PaymentReminder = {
  entry: LedgerEntry;
  customerName: string;
  company: string;
};

type NotificationsPanelProps = {
  dueReminders: DueReminder[];
  paymentReminders: PaymentReminder[];
  onSelectCustomer: (customerId: string) => void;
  onClose: () => void;
};

export default function NotificationsPanel({
  dueReminders,
  paymentReminders,
  onSelectCustomer,
  onClose,
}: NotificationsPanelProps) {
  return (
    <section
      className="notification-popover"
      id="notifications-popover"
      aria-labelledby="notifications-title"
      role="region"
    >
      <header className="notification-popover-header">
        <div>
          <span className="eyebrow">HESAP TAKİBİ</span>
          <h2 id="notifications-title">Bildirimler</h2>
          <p>Son tahsilatlar ve vade hatırlatmaları</p>
        </div>
        <button type="button" className="icon-button" onClick={onClose} aria-label="Bildirimleri kapat">
          <X size={17} />
        </button>
      </header>

      <section className="notification-group" aria-labelledby="notification-dues-title">
        <div className="notification-group-heading">
          <h3 id="notification-dues-title">Vade hatırlatmaları</h3>
          <span>{dueReminders.length}</span>
        </div>
        {dueReminders.length ? (
          <div className="notification-items">
            {dueReminders.map(({ customer, status, statusLabel }) => {
              const Icon = status === 'overdue' ? AlertCircle : Clock3;
              return (
                <button
                  type="button"
                  className={`notification-item due ${status}`}
                  key={customer.id}
                  onClick={() => onSelectCustomer(customer.id)}
                  aria-label={`${customer.name}, ${statusLabel}, kalan bakiye ${money(customer.balance)}`}
                >
                  <span className={`notification-item-icon ${status}`}><Icon size={16} /></span>
                  <span className="notification-item-copy">
                    <strong>{customer.name}</strong>
                    <span>{customer.company || 'Bireysel müşteri'}</span>
                    <small>{statusLabel} · {formatDate(customer.currentDueDate)}</small>
                  </span>
                  <span className="notification-item-amount">{money(customer.balance)}</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="notification-empty">Gecikmiş veya 7 gün içinde vadesi olan açık cari yok.</p>
        )}
      </section>

      <section className="notification-group" aria-labelledby="notification-payments-title">
        <div className="notification-group-heading">
          <h3 id="notification-payments-title">Son tahsilatlar</h3>
          <span>{paymentReminders.length}</span>
        </div>
        {paymentReminders.length ? (
          <div className="notification-items">
            {paymentReminders.map(({ entry, customerName, company }) => (
              <button
                type="button"
                className="notification-item payment"
                key={entry.id}
                onClick={() => onSelectCustomer(entry.customerId)}
                aria-label={`${customerName}, ${formatDate(entry.date)} tarihinde tahsil edilen ${money(entry.amount)}`}
              >
                <span className="notification-item-icon payment"><ArrowDownLeft size={16} /></span>
                <span className="notification-item-copy">
                  <strong>{customerName}</strong>
                  <span>{company || entry.note || 'Tahsilat kaydı'}</span>
                  <small>{formatDate(entry.date)}{company && entry.note ? ` · ${entry.note}` : ''}</small>
                </span>
                <span className="notification-item-amount">{money(entry.amount)}</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="notification-empty">Son hareketlerde tahsilat bulunmuyor.</p>
        )}
      </section>

      <footer className="notification-popover-footer">
        <CalendarClock size={14} /> Vade uyarıları mevcut cari vade durumuyla eşleşir.
      </footer>
    </section>
  );
}
