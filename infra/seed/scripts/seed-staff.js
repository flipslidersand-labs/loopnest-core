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
    const staffYaml = yaml.load(fs.readFileSync(path.join(__dirname, '../static/staff.yaml'), 'utf-8'));
    const orgYaml = yaml.load(fs.readFileSync(path.join(__dirname, '../static/organizations.yaml'), 'utf-8'));

    // Build organization ID → database UUID mapping
    const orgMap = {};
    for (const org of orgYaml.organizations) {
      const result = await pool.query(
        'SELECT id FROM core.organizations WHERE name = $1',
        [org.name]
      );
      if (result.rows.length) {
        orgMap[org.id] = result.rows[0].id;
      }
    }

    console.log(`📦 Inserting ${staffYaml.staff.length} staff members...`);

    for (const staff of staffYaml.staff) {
      const org_id = orgMap[staff.organization_id];
      if (!org_id) {
        console.warn(`⚠️ Organization not found for ${staff.name} (org: ${staff.organization_id}), skipping`);
        continue;
      }

      const profile = {
        age: staff.age,
        tenure_years: staff.tenure_years,
        speed: staff.speed,
        accuracy: staff.accuracy,
        habits: staff.habits,
        active_hours: staff.active_hours,
        active_weekdays: staff.active_weekdays || [1, 2, 3, 4, 5],
        monthly_load_curve: staff.monthly_load_curve,
        ...(staff.languages && { languages: staff.languages }),
        ...(staff.specialties && { specialties: staff.specialties }),
        ...(staff.customer_segment && { customer_segment: staff.customer_segment }),
      };

      await pool.query(
        'INSERT INTO core.users (id, name, name_en, email, organization_id, role, profile) VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)',
        [staff.name, staff.name_en, staff.email, org_id, staff.role, profile]
      );
    }

    const countResult = await pool.query('SELECT COUNT(*) FROM core.users');
    console.log(`✅ ${countResult.rows[0].count} users in database`);

    await pool.end();
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
}

main();
