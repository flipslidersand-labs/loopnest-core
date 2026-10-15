import { createHmac } from 'crypto';
import { describe, it, expect } from 'vitest';
import { signToken, verifyToken, type JwtPayload } from './jwt.js';

const SECRET = 'test-secret';

function b64url(input: Buffer | string): string {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildToken(
  payload: Record<string, unknown>,
  secret = SECRET,
  { badSignature = false }: { badSignature?: boolean } = {},
): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = badSignature
    ? b64url(Buffer.from('not-a-real-signature'))
    : b64url(createHmac('sha256', secret).update(`${header}.${body}`).digest());
  return `${header}.${body}.${sig}`;
}

describe('signToken / verifyToken', () => {
  it('round-trips a valid payload', () => {
    const token = signToken({ sub: 'user-1', role: 'admin' }, SECRET);
    const decoded = verifyToken(token, SECRET);
    expect(decoded?.sub).toBe('user-1');
    expect(decoded?.role).toBe('admin');
    expect(decoded?.iat).toBeTypeOf('number');
    expect(decoded?.exp).toBeTypeOf('number');
  });

  it('rejects a token with the wrong number of segments', () => {
    expect(verifyToken('only.two', SECRET)).toBeNull();
    expect(verifyToken('a.b.c.d', SECRET)).toBeNull();
  });

  it('rejects a token whose payload was tampered with (signature mismatch)', () => {
    const token = signToken({ sub: 'user-1', role: 'admin' }, SECRET);
    const [header, , sig] = token.split('.');
    const tamperedPayload = b64url(JSON.stringify({ sub: 'attacker', role: 'admin' }));
    expect(verifyToken(`${header}.${tamperedPayload}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects a signature of a different byte length', () => {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64url(JSON.stringify({ sub: 'user-1', role: 'admin' }));
    const shortSig = b64url(Buffer.from('short'));
    expect(verifyToken(`${header}.${body}.${shortSig}`, SECRET)).toBeNull();
  });

  it('rejects a token signed with a different secret', () => {
    const token = buildToken({ sub: 'user-1', role: 'admin' }, 'wrong-secret');
    expect(verifyToken(token, SECRET)).toBeNull();
  });

  it('rejects invalid base64 in the payload segment', () => {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const badPayload = '***not-base64***';
    const sig = b64url(createHmac('sha256', SECRET).update(`${header}.${badPayload}`).digest());
    expect(verifyToken(`${header}.${badPayload}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects a payload that is valid base64 but not valid JSON', () => {
    const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const badPayload = b64url('this is not json');
    const sig = b64url(createHmac('sha256', SECRET).update(`${header}.${badPayload}`).digest());
    expect(verifyToken(`${header}.${badPayload}.${sig}`, SECRET)).toBeNull();
  });

  it('rejects a payload missing sub', () => {
    const token = buildToken({ role: 'admin' });
    expect(verifyToken(token, SECRET)).toBeNull();
  });

  it('rejects a payload missing role', () => {
    const token = buildToken({ sub: 'user-1' });
    expect(verifyToken(token, SECRET)).toBeNull();
  });

  it('rejects an expired token', () => {
    const past = Math.floor(Date.now() / 1000) - 10;
    const token = buildToken({ sub: 'user-1', role: 'admin', exp: past });
    expect(verifyToken(token, SECRET)).toBeNull();
  });

  it('accepts a token expiring in the future', () => {
    const future = Math.floor(Date.now() / 1000) + 3600;
    const token = buildToken({ sub: 'user-1', role: 'admin', exp: future });
    expect(verifyToken(token, SECRET)).not.toBeNull();
  });

  it('accepts a token with no exp claim at all', () => {
    const token = buildToken({ sub: 'user-1', role: 'admin' });
    const decoded = verifyToken(token, SECRET);
    expect(decoded?.exp).toBeUndefined();
    expect(decoded?.sub).toBe('user-1');
  });
});
