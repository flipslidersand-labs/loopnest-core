#!/usr/bin/env node
import pg from 'pg';
import yaml from 'js-yaml';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'loopnest',
  password: process.env.POSTGRES_PASSWORD || 'loopnest_dev_password',
  database: process.env.POSTGRES_DB || 'omni_local',
});

async function main() {
  try {
    const productsYaml = yaml.load(fs.readFileSync(path.join(__dirname, '../static/products.yaml'), 'utf-8'));

    console.log(`📦 Inserting ${productsYaml.products.length} products...`);

    // Map product categories to allowed database values
    const categoryMap = {
      'software_license': 'server',
      'cloud_service': 'server',
      'professional_service': 'server',
      'hardware': 'server',
      'support_maintenance': 'network',
    };

    for (const product of productsYaml.products) {
      const dbCategory = categoryMap[product.category] || 'laptop';
      await pool.query(
        `INSERT INTO core.products (sku, name, category, unit_price)
         VALUES ($1, $2, $3, $4)`,
        [
          product.sku,
          product.name,
          dbCategory,
          Math.round(product.unit_price / 100), // Convert to cents
        ]
      );
    }

    const countResult = await pool.query('SELECT COUNT(*) FROM core.products');
    console.log(`✅ ${countResult.rows[0].count} products in database`);

    await pool.end();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
