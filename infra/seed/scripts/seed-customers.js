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
    const customersYaml = yaml.load(fs.readFileSync(path.join(__dirname, '../static/customers.yaml'), 'utf-8'));

    console.log(`📦 Inserting ${customersYaml.customers.length} customers...`);

    for (const customer of customersYaml.customers) {
      await pool.query(
        `INSERT INTO core.customers (name, postal_code, address, phone)
         VALUES ($1, $2, $3, $4)`,
        [
          customer.name,
          '000-0000', // placeholder postal code
          customer.address,
          customer.contact_phone,
        ]
      );
    }

    const countResult = await pool.query('SELECT COUNT(*) FROM core.customers');
    console.log(`✅ ${countResult.rows[0].count} customers in database`);

    await pool.end();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
