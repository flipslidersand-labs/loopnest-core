import PDFDocument from 'pdfkit';
import { RepositoryContainer, type Product } from '@loopnest/bizcore-db';
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

interface LineItem {
  productName: string;
  productSku?: string;
  quantity: number;
  unitPrice: number;
  lineTotal: number;
}

interface DocumentData {
  title: string;
  docNumber: string;
  issueDate: Date;
  expiryLabel?: string;
  expiryDate?: Date | null;
  customerName: string;
  customerAddress?: string;
  customerPhone?: string;
  issuerName: string;
  registrationNumber?: string;
  items: LineItem[];
  subtotal: number;
  taxAmount: number;
  totalAmount: number;
  statusBadge?: { text: string; color: string } | null;
  footerText: string;
}

export class PdfService {
  constructor(private repos: RepositoryContainer) {}

  // ── Public API ────────────────────────────────────────────────────────────

  async generateInvoicePdf(invoiceId: string): Promise<Buffer> {
    const [invoice, org] = await Promise.all([
      this.repos.invoices.findWithItems(invoiceId),
      this.repos.organizations.findAll().then(orgs => orgs[0] ?? null),
    ]);
    if (!invoice) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Invoice not found');

    const customer = await this.repos.customers.findById(invoice.customerId);

    const data: DocumentData = {
      title: '請求書',
      docNumber: invoice.invoiceNumber,
      issueDate: invoice.createdAt,
      customerName: customer?.name ?? '(顧客不明)',
      customerAddress: customer?.address,
      customerPhone: customer?.phone,
      issuerName: org?.name ?? 'LoopNest Tech 株式会社',
      registrationNumber: (invoice as any).registrationNumber,
      items: invoice.items.map(i => ({
        productName: i.productName,
        productSku: i.productSku,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        lineTotal: i.lineTotal,
      })),
      subtotal: invoice.subtotal,
      taxAmount: invoice.taxAmount,
      totalAmount: invoice.totalAmount,
      statusBadge: invoice.status === 'paid'
        ? { text: 'PAID', color: 'green' }
        : null,
      footerText: '本請求書に関するお問い合わせはご担当者までご連絡ください。',
    };

    return this.renderPdf(invoice.invoiceNumber, data);
  }

  async generateQuotePdf(quoteId: string, organizationId?: string): Promise<Buffer> {
    const [quote, org] = await Promise.all([
      this.repos.quotes.findWithItems(quoteId, organizationId),
      this.repos.organizations.findAll().then(orgs => orgs[0] ?? null),
    ]);
    if (!quote) throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');

    const customer = await this.repos.customers.findById(quote.customerId);

    // Batch-fetch product names for quote items (QuoteWithItems has productId but no name)
    const productIds = [...new Set((quote.items ?? []).map((i: { productId: string }) => i.productId))];
    const products = await Promise.all(productIds.map((id: string) => this.repos.products.findById(id)));
    const productMap = new Map(
      products.filter((p): p is Product => p !== null).map((p: Product) => [p.id, p])
    );

    const statusBadge = quote.status === 'approved'
      ? { text: 'APPROVED', color: '#0055aa' }
      : quote.status === 'rejected'
        ? { text: 'REJECTED', color: '#cc0000' }
        : null;

    const data: DocumentData = {
      title: '見積書',
      docNumber: quote.quoteNumber,
      issueDate: quote.createdAt,
      expiryLabel: '有効期限',
      expiryDate: null,
      customerName: customer?.name ?? '(顧客不明)',
      customerAddress: customer?.address,
      customerPhone: customer?.phone,
      issuerName: org?.name ?? 'LoopNest Tech 株式会社',
      items: (quote.items ?? []).map((i: { productId: string; quantity: number; unitPrice: number; lineTotal: number }) => {
        const product = productMap.get(i.productId);
        return {
          productName: product?.name ?? i.productId,
          productSku: product?.sku,
          quantity: i.quantity,
          unitPrice: i.unitPrice,
          lineTotal: i.lineTotal,
        };
      }),
      subtotal: quote.subtotalAmount,
      taxAmount: quote.taxAmount,
      totalAmount: quote.totalAmount,
      statusBadge,
      footerText: 'この見積書に関するお問い合わせはご担当者までご連絡ください。',
    };

    return this.renderPdf(quote.quoteNumber, data);
  }

  // ── Shared renderer ───────────────────────────────────────────────────────

  private renderPdf(title: string, data: DocumentData): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ size: 'A4', margin: 50, info: { Title: title } });
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      this.renderDocument(doc, data);
      doc.end();
    });
  }

  private renderDocument(doc: InstanceType<typeof PDFDocument>, data: DocumentData): void {
    const pageWidth = doc.page.width - 100;

    // Title
    doc.fontSize(24).font('Helvetica-Bold').text(data.title, { align: 'center' });
    doc.moveDown(0.5);

    // Meta block
    doc.fontSize(10).font('Helvetica');
    const metaX = 350;
    doc.text(`${data.title}番号: ${data.docNumber}`, metaX, doc.y);
    doc.text(`発行日: ${formatDate(data.issueDate)}`, metaX);
    if (data.expiryLabel) {
      doc.text(`${data.expiryLabel}: ${formatDate(data.expiryDate)}`, metaX);
    }
    doc.moveDown(1);

    // Separator
    doc.moveTo(50, doc.y).lineTo(50 + pageWidth, doc.y).stroke();
    doc.moveDown(0.8);

    // Bill To / From
    const col1 = 50;
    const col2 = 300;
    const topY = doc.y;

    doc.font('Helvetica-Bold').fontSize(10).text('宛先', col1, topY);
    doc.font('Helvetica').fontSize(11)
      .text(data.customerName, col1, doc.y)
      .fontSize(9)
      .text(data.customerAddress ?? '', col1)
      .text(data.customerPhone ? `TEL: ${data.customerPhone}` : '', col1);

    doc.font('Helvetica-Bold').fontSize(10).text('発行元', col2, topY);
    doc.font('Helvetica').fontSize(11)
      .text(data.issuerName, col2, topY + 14)
      .fontSize(9);
    if (data.registrationNumber) {
      doc.text(`登録番号: ${data.registrationNumber}`, col2);
    }

    doc.moveDown(2);
    doc.moveTo(50, doc.y).lineTo(50 + pageWidth, doc.y).stroke();
    doc.moveDown(0.8);

    // Items table
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
    doc.strokeColor('black').moveDown(0.3);

    doc.font('Helvetica').fontSize(9);
    for (const item of data.items) {
      const rowY = doc.y;
      doc.text(item.productName, startX, rowY, { width: colW.name });
      doc.text(String(item.quantity), startX + colW.name, rowY, { width: colW.qty, align: 'right' });
      doc.text(formatCurrency(item.unitPrice), startX + colW.name + colW.qty, rowY, { width: colW.unit, align: 'right' });
      doc.text(formatCurrency(item.lineTotal), startX + colW.name + colW.qty + colW.unit, rowY, { width: colW.total, align: 'right' });
      doc.moveDown(0.6);
    }

    doc.moveDown(0.3);
    doc.moveTo(50, doc.y).lineTo(50 + pageWidth, doc.y).strokeColor('#888').stroke();
    doc.strokeColor('black').moveDown(0.8);

    // Totals
    const totalsX = startX + colW.name + colW.qty;
    const totalsLabelW = colW.unit;
    const totalsValW = colW.total;

    const addRow = (label: string, value: string, bold = false) => {
      const y = doc.y;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      doc.text(label, totalsX, y, { width: totalsLabelW, align: 'right' });
      doc.text(value, totalsX + totalsLabelW, y, { width: totalsValW, align: 'right' });
      doc.moveDown(0.5);
    };

    addRow('小計', formatCurrency(data.subtotal));
    addRow(`消費税 (${TAX_RATE * 100}%)`, formatCurrency(data.taxAmount));

    doc.moveDown(0.2);
    doc.moveTo(totalsX, doc.y).lineTo(totalsX + totalsLabelW + totalsValW, doc.y).stroke();
    doc.moveDown(0.3);

    addRow('合計金額', formatCurrency(data.totalAmount), true);

    // Status badge
    if (data.statusBadge) {
      doc.save();
      doc.fontSize(36).font('Helvetica-Bold').fillOpacity(0.12)
        .fillColor(data.statusBadge.color)
        .text(data.statusBadge.text, 50, 400, { align: 'center' });
      doc.restore();
    }

    // Footer
    doc.fontSize(8).font('Helvetica').fillColor('#666')
      .text(data.footerText, 50, doc.page.height - 60, {
        align: 'center',
        width: pageWidth,
      });
  }
}
