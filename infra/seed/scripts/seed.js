#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import yaml from 'js-yaml';
import pg from 'pg';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const pool = new pg.Pool({
  host: process.env.POSTGRES_HOST || 'localhost',
  port: parseInt(process.env.POSTGRES_PORT || '5432'),
  user: process.env.POSTGRES_USER || 'loopnest',
  password: process.env.POSTGRES_PASSWORD || 'loopnest_dev_password',
  database: process.env.POSTGRES_DB || 'omni_local',
});

async function seedOrganizations() {
  console.log('📦 Seeding organizations...');
  const orgYaml = yaml.load(
    fs.readFileSync(path.join(__dirname, '../static/organizations.yaml'), 'utf-8')
  );

  for (const org of orgYaml.organizations) {
    await pool.query(
      'INSERT INTO core.organizations (id, name, type, parent_id) VALUES ($1, $2, $3, $4)',
      [org.id, org.name, org.type, org.parent_id || null]
    );
  }
  console.log(`✅ ${orgYaml.organizations.length} organizations seeded`);
}

async function seedStaff() {
  console.log('📦 Seeding staff...');
  const staffYaml = yaml.load(
    fs.readFileSync(path.join(__dirname, '../static/staff.yaml'), 'utf-8')
  );

  for (const staff of staffYaml.staff) {
    const profile = {
      age: staff.age,
      tenure_years: staff.tenure_years,
      speed: staff.speed,
      accuracy: staff.accuracy,
      habits: staff.habits,
      active_hours: staff.active_hours,
      active_weekdays: staff.active_weekdays,
      monthly_load_curve: staff.monthly_load_curve,
      ...(staff.languages && { languages: staff.languages }),
      ...(staff.specialties && { specialties: staff.specialties }),
      ...(staff.customer_segment && { customer_segment: staff.customer_segment }),
      ...(staff.certifications && { certifications: staff.certifications }),
    };

    await pool.query(
      'INSERT INTO core.users (id, name, name_en, email, organization_id, role, profile) VALUES ($1, $2, $3, $4, $5, $6, $7)',
      [staff.id, staff.name, staff.name_en, staff.email, staff.organization_id, staff.role, profile]
    );
  }
  console.log(`✅ ${staffYaml.staff.length} staff members seeded`);
}

async function main() {
  try {
    console.log('🌱 Starting seed...\n');
    await seedOrganizations();
    await seedStaff();
    console.log('\n✨ Seed complete!');
    await pool.end();
  } catch (err) {
    console.error('❌ Seed failed:', err);
    process.exit(1);
  }
}

main();
