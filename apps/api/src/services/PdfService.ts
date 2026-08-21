import PDFDocument from 'pdfkit';
import { RepositoryContainer } from '@loopnest/bizcore-db';
import { ApiErrorResponse } from '../middleware/errorHandler.js';

const TAX_RATE = 0.10;

function formatCurrency(amount: number): string {
  return `¥${Math.round(amount).toLocaleString('ja-JP')}`;
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return '—';
  const date = d instanceof Date ? d : new Date(d);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export class PdfService {
  constructor(private repos: RepositoryContainer) {}

  async generateInvoicePdf(invoiceId: string): Promise<Buffer> {
    const [invoice, org] = await Promise.all([
      this.repos.invoices.findWithItems(invoiceId),
      this.repos.organizations.findAll().then(orgs => orgs[0] ?? null),
    ]);

    if (!invoice) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Invoice not found');

    const customer = await this.repos.customers.findById(invoice.customerId);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: invoice.invoiceNumber } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);

      this.renderInvoice(doc, invoice, customer, org);
      doc.end();
    });
  }

  private renderInvoice(doc: InstanceType<typeof PDFDocument>, invoice: any, customer: any, org: any): void {
    const pageWidth = doc.page.width - 100;

    // ── Title ──────────────────────────────────────────────────────────────
    doc.fontSize(24).font('Helvetica-Bold').text('請求書', { align: 'center' });
    doc.moveDown(0.5);

    // ── Meta block (right side) ────────────────────────────────────────────
    doc.fontSize(10).font('Helvetica');
    const metaX = 350;
    doc.text(`請求書番号: ${invoice.invoiceNumber}`, metaX, doc.y);
    doc.text(`発行日: ${formatDate(invoice.createdAt)}`, metaX);
    if (invoice.paidAt) {
      doc.text(`支払日: ${formatDate(invoice.paidAt)}`, metaX);
    }
    if (invoice.status !== 'paid') {
      doc.text(`支払期限: —`, metaX);
    }
    doc.moveDown(1);

    // ── Separator ──────────────────────────────────────────────────────────
    doc.moveTo(50, doc.y).lineTo(50 + pageWidth, doc.y).stroke();
    doc.moveDown(0.8);

    // ── Bill To / From ────────────────────────────────────────────────────
    const col1 = 50;
    const col2 = 300;
    const topY = doc.y;

    doc.font('Helvetica-Bold').fontSize(10).text('請求先', col1, topY);
    doc.font('Helvetica').fontSize(11)
      .text(customer?.name ?? '(顧客不明)', col1, doc.y)
      .fontSize(9)
      .text(customer?.address ?? '', col1)
      .text(customer?.phone ? `TEL: ${customer.phone}` : '', col1);

    doc.font('Helvetica-Bold').fontSize(10).text('発行元', col2, topY);
    doc.font('Helvetica').fontSize(11)
      .text(org?.name ?? 'LoopNest Tech 株式会社', col2, topY + 14)
      .fontSize(9);
    if (invoice.registrationNumber) {
      doc.text(`登録番号: ${invoice.registrationNumber}`, col2);
    }

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(50 + pageWidth, doc.y).stroke();
    doc.moveDown(0.8);

    // ── Items table ────────────────────────────────────────────────────────
    const colW = { name: 220, qty: 60, unit: 100, total: 100 };
    const startX = 50;
    const headerY = doc.y;

    doc.font('Helvetica-Bold').fontSize(9);
    doc.text('品目', startX, headerY);
    doc.text('数量', startX + colW.name, headerY, { width: colW.qty, align: 'right' });
    doc.text('単価', startX + colW.name + colW.qty, headerY, { width: colW.unit, align: 'right' });
    doc.text('金額', startX + colW.name + colW.qty + colW.unit, headerY, { width: colW.total, align: 'right' });

    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(50 + pageWidth, doc.y).strokeColor('#888').stroke();
    doc.strokeColor('black');
    doc.moveDown(0.3);

    doc.font('Helvetica').fontSize(9);
    for (const item of invoice.items) {
      const rowY = doc.y;
      doc.text(item.productName, startX, rowY, { width: colW.name });
      doc.text(String(item.quantity), startX + colW.name, rowY, { width: colW.qty, align: 'right' });
      doc.text(formatCurrency(item.unitPrice), startX + colW.name + colW.qty, rowY, { width: colW.unit, align: 'right' });
      doc.text(formatCurrency(item.lineTotal), startX + colW.name + colW.qty + colW.unit, rowY, { width: colW.total, align: 'right' });
      doc.moveDown(0.6);
    }

    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(50 + pageWidth, doc.y).strokeColor('#888').stroke();
    doc.strokeColor('black');
    doc.moveDown(0.8);

    // ── Totals ─────────────────────────────────────────────────────────────
    const totalsX = startX + colW.name + colW.qty;
    const totalsLabelW = colW.unit;
    const totalsValW = colW.total;

    const addTotalRow = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      doc.text(label, totalsX, y, { width: totalsLabelW, align: 'right' });
      doc.text(value, totalsX + totalsLabelW, y, { width: totalsValW, align: 'right' });
      doc.moveDown(0.5);
    };

    addTotalRow('小計', formatCurrency(invoice.subtotal));
    addTotalRow(`消費税 (${TAX_RATE * 100}%)`, formatCurrency(invoice.taxAmount));

    doc.moveDown(0.2);
    doc.moveTo(totalsX, doc.y).lineTo(totalsX + totalsLabelW + totalsValW, doc.y).stroke();
    doc.moveDown(0.3);

    addTotalRow('合計金額', formatCurrency(invoice.totalAmount), true);

    // ── Status badge ───────────────────────────────────────────────────────
    if (invoice.status === 'paid') {
      doc.save();
      doc.fontSize(36).font('Helvetica-Bold').fillOpacity(0.12)
        .fillColor('green')
        .text('PAID', 50, 400, { align: 'center' });
      doc.restore();
    }

    // ── Footer ─────────────────────────────────────────────────────────────
    doc.fontSize(8).font('Helvetica').fillColor('#666')
      .text('本請求書に関するお問い合わせはご担当者までご連絡ください。', 50, doc.page.height - 60, {
        align: 'center',
        width: pageWidth,
      });
  }
}
