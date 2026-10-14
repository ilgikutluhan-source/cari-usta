import { renderCustomerStatementMarkup } from './components/CustomerPrint';
import type { Customer, LedgerEntry } from './models';

type PdfWorker = {
  set(options: Record<string, unknown>): PdfWorker;
  from(element: HTMLElement): PdfWorker;
  toCanvas(): PdfWorker;
  get(key: 'canvas'): Promise<HTMLCanvasElement>;
  toPdf(): PdfWorker;
  outputPdf(type: 'blob'): Promise<Blob>;
};
type PdfFactory = () => PdfWorker;

function flattenRules(rules: CSSRuleList): string {
  return Array.from(rules).map((rule) => {
    if (rule.type === CSSRule.PAGE_RULE) return '';
    if (rule.type === CSSRule.MEDIA_RULE) return flattenRules((rule as CSSMediaRule).cssRules);
    return rule.cssText;
  }).join('\n');
}

function customerPrintCss(): string {
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const output = Array.from(sheet.cssRules)
        .filter((rule) => rule.type === CSSRule.MEDIA_RULE)
        .filter((rule) => (rule as CSSMediaRule).conditionText.trim() === 'print')
        .map((rule) => flattenRules((rule as CSSMediaRule).cssRules))
        .join('\n');
      if (output.includes('.customer-print-sheet') && output.includes('.print-ledger-table')) return output;
    } catch {
      // Cross-origin stylesheets cannot be read; continue to the local print stylesheet.
    }
  }
  throw new Error('A4 ekstre stilleri yüklenemedi. Sayfayı yenileyip tekrar deneyin.');
}

function safeFileName(customerName: string): string {
  const safeName = customerName.trim()
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 70) || 'Musteri';
  return `${safeName}-cari-ekstresi-${new Date().toISOString().slice(0, 10)}.pdf`;
}

/** Builds an A4 statement PDF locally in the browser; customer data is not uploaded. */
export async function createCustomerStatementPdf(customer: Customer, entries: LedgerEntry[]): Promise<File> {
  const markup = await renderCustomerStatementMarkup(customer, entries);
  const printCss = customerPrintCss();
  const scopedPrintCss = printCss
    .replace(/(?:^|\n)\s*html,\s*body\s*\{[^}]*\}/, '')
    .replace(/(?:^|\n)\s*body\s*>\s*(?:\*)?\s*:not\(\.customer-print-sheet\)\s*\{[^}]*\}/, '');
  const template = document.createElement('template');
  template.innerHTML = markup;
  const element = template.content.querySelector<HTMLElement>('.customer-print-sheet');
  if (!element) throw new Error('Cari ekstresi PDF için hazırlanamadı.');

  const style = document.createElement('style');
  style.textContent = `${scopedPrintCss}\n.customer-print-sheet{display:block!important;position:relative!important;width:186mm!important;max-width:186mm!important;min-height:0!important;margin:0!important;padding:0!important;overflow:visible!important;background:#fff!important}`;
  document.head.appendChild(style);
  document.body.appendChild(element);

  try {
    element.setAttribute('aria-hidden', 'true');
    await document.fonts.ready;
    await Promise.all(Array.from(element.querySelectorAll('img')).map((image) => image.decode().catch(() => undefined)));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    const { default: html2pdf } = await import('html2pdf.js');
    const worker = (html2pdf as PdfFactory)()
      .set({
        margin: [12, 12, 12, 12],
        filename: safeFileName(customer.name),
        image: { type: 'jpeg', quality: 0.97 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          backgroundColor: '#ffffff',
          windowWidth: 794,
          windowHeight: 1123,
          scrollX: 0,
          scrollY: 0,
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['css', 'legacy'] },
      })
      .from(element);
    const canvas = await worker.toCanvas().get('canvas');
    if (!canvas.width || !canvas.height) throw new Error('Ekstre PDF görüntüsü oluşturulamadı.');
    const pdfBlob = await worker.toPdf().outputPdf('blob');

    if (pdfBlob.size < 100) throw new Error('Ekstre PDF dosyası oluşturulamadı.');
    return new File([pdfBlob], safeFileName(customer.name), { type: 'application/pdf' });
  } finally {
    element.remove();
    style.remove();
  }
}

export function downloadPdfFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.rel = 'noopener';
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
