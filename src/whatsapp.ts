import { formatDate, money } from './models';

export type WhatsAppReminderCustomer = {
  name: string;
  phone: string;
  balance: number;
  currentDueDate?: string;
};

/** Converts common Turkish local numbers or E.164 input into wa.me's digits-only format. */
export function normalizeWhatsAppPhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 10) digits = `90${digits}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : null;
}

/** Creates the reminder text; the user reviews and sends it in WhatsApp. */
export function createWhatsAppReminderMessage(customer: WhatsAppReminderCustomer): string | null {
  if (!Number.isFinite(customer.balance) || customer.balance <= 0) return null;
  const name = customer.name.trim();
  if (!name) return null;
  const hasDueDate = /^\d{4}-\d{2}-\d{2}$/.test(customer.currentDueDate ?? '');
  const dueNotice = hasDueDate
    ? `Ödeme vadeniz ${formatDate(customer.currentDueDate!)} olarak kayıtlıdır.`
    : 'Ödeme vadeniz henüz sistemimize kaydedilmemiştir.';
  const paymentRequest = hasDueDate
    ? 'Ödemenizi vade tarihine kadar yapmanızı rica ederiz.'
    : 'Ödemenizi en kısa sürede yapmanızı rica ederiz.';
  return `Merhaba ${name}, Çalışkanlar Yapı Market cari hesabınızda ${money(customer.balance)} tutarında açık borcunuz bulunmaktadır. ${dueNotice} ${paymentRequest} Cari ekstre PDF’ini incelemeniz için mesaja ekliyorum. Ödeme yaptıysanız lütfen bu mesajı dikkate almayınız. Teşekkür ederiz.`;
}

/** Creates a WhatsApp compose link; the user reviews and sends the message in WhatsApp. */
export function createWhatsAppReminderUrl(customer: WhatsAppReminderCustomer): string | null {
  const phone = normalizeWhatsAppPhone(customer.phone);
  const message = createWhatsAppReminderMessage(customer);
  return phone && message ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null;
}
