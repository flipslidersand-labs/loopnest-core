#!/usr/bin/env node
import pg from 'pg';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'loopnest',
  password: process.env.POSTGRES_PASSWORD || 'loopnest_dev_password',
  database: process.env.POSTGRES_DB || 'omni_local',
});

function generateQuoteNumber() {
  const year = new Date().getFullYear();
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  const random = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(5, '0');
  return `Q${year}${month}-${random}`;
}

async function main() {
  try {
    // Get sample data
    const customersRes = await pool.query('SELECT id FROM core.customers LIMIT 10');
    const customersIds = customersRes.rows.map(r => r.id);

    const staffRes = await pool.query('SELECT id FROM core.users WHERE role IN (\'sales_rep\', \'manager\') LIMIT 10');
    const staffIds = staffRes.rows.map(r => r.id);

    const productsRes = await pool.query('SELECT id, unit_price FROM core.products LIMIT 20');
    const products = productsRes.rows;

    console.log(`📦 Creating sample quote requests and quotes...`);
    let quoteCount = 0;

    // Create 10 sample quotes
    for (let i = 0; i < 10 && i < customersIds.length && i < staffIds.length; i++) {
      const customerId = customersIds[i];
      const createdBy = staffIds[i % staffIds.length];

      // Create quote request
      const quoteReqRes = await pool.query(
        `INSERT INTO core.quote_requests (customer_id, requested_by, contact_email, requested_items, status, created_by)
         VALUES ($1, $2, $3, $4, 'received', $5)
         RETURNING id`,
        [customerId, 'Sample Contact', 'contact@example.com', JSON.stringify({ items: [] }), createdBy]
      );
      const quoteRequestId = quoteReqRes.rows[0].id;

      // Create quote with unique quote_number
      const quoteNumber = generateQuoteNumber();
      const quoteRes = await pool.query(
        `INSERT INTO core.quotes (quote_number, quote_request_id, customer_id, subtotal_amount, tax_amount, total_amount, status, created_by)
         VALUES ($1, $2, $3, 0, 0, 0, 'draft', $4)
         RETURNING id`,
        [quoteNumber, quoteRequestId, customerId, createdBy]
      );
      const quoteId = quoteRes.rows[0].id;

      // Add 2-4 quote items
      const itemCount = Math.floor(Math.random() * 3) + 2;
      let subtotal = 0;

      for (let j = 0; j < itemCount; j++) {
        const product = products[Math.floor(Math.random() * products.length)];
        const quantity = Math.floor(Math.random() * 5) + 1;
        const unitPrice = parseFloat(product.unit_price);
        const lineTotal = unitPrice * quantity;
        subtotal += lineTotal;

        await pool.query(
          `INSERT INTO core.quote_items (quote_id, product_id, quantity, unit_price, line_total)
           VALUES ($1, $2, $3, $4, $5)`,
          [quoteId, product.id, quantity, unitPrice, lineTotal]
        );
      }

      // Update quote totals (assuming 10% tax)
      const tax = Math.round(subtotal * 0.1);
      const total = subtotal + tax;
      await pool.query(
        'UPDATE core.quotes SET subtotal_amount = $1, tax_amount = $2, total_amount = $3 WHERE id = $4',
        [subtotal, tax, total, quoteId]
      );

      quoteCount++;
    }

    console.log(`✅ ${quoteCount} quotes with items created`);

    const quoteRes = await pool.query('SELECT COUNT(*) FROM core.quotes');
    const quoteItemRes = await pool.query('SELECT COUNT(*) FROM core.quote_items');
    console.log(`   Total quotes: ${quoteRes.rows[0].count}`);
    console.log(`   Total quote items: ${quoteItemRes.rows[0].count}`);

    await pool.end();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
