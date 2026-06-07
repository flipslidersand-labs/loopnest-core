#!/usr/bin/env node
// Usage: node gen-token.mjs <sub> <role> [expiresInSecs] [orgId]
// Env:   JWT_SECRET (default: loopnest_dev_secret)
import { createHmac } from 'crypto';

const [sub, role, expiresIn = '3600', orgId] = process.argv.slice(2);
if (!sub || !role) {
  process.stderr.write('Usage: gen-token.mjs <sub> <role> [expiresInSecs] [orgId]\n');
  process.exit(1);
}

const secret = process.env.JWT_SECRET ?? 'loopnest_dev_secret';
const now = Math.floor(Date.now() / 1000);
const exp = now + Number.parseInt(expiresIn, 10);

const claims = { sub, role, email: `${sub}@test.local`, iat: now, exp };
if (orgId) claims.orgId = orgId;

const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
const sig     = createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');

process.stdout.write(`${header}.${payload}.${sig}\n`);
