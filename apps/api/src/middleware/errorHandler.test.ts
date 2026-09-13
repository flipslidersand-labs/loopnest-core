import { describe, it, expect, vi } from 'vitest';
import { errorHandler, ApiErrorResponse, asyncHandler } from './errorHandler.js';

function makeRes() {
  const json = vi.fn();
  const status = vi.fn().mockReturnValue({ json });
  return { status, json, _json: json } as any;
}

function makeReqNext() {
  return { req: {} as any, next: vi.fn() };
}

describe('errorHandler', () => {
  it('ApiErrorResponse → correct status and body', () => {
    const err = new ApiErrorResponse(422, 'VALIDATION_ERROR', 'bad input');
    const res = makeRes();
    const { req, next } = makeReqNext();
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.status().json).toHaveBeenCalledWith({ error: { code: 'VALIDATION_ERROR', message: 'bad input' } });
  });

  it('plain error with statusCode → uses statusCode', () => {
    const err = Object.assign(new Error('not found'), { statusCode: 404, code: 'NOT_FOUND' });
    const res = makeRes();
    const { req, next } = makeReqNext();
    errorHandler(err, req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.status().json).toHaveBeenCalledWith({ error: { code: 'NOT_FOUND', message: 'not found' } });
  });

  it('plain error with statusCode but no code → defaults to INTERNAL_ERROR', () => {
    const err = Object.assign(new Error('boom'), { statusCode: 500 });
    const res = makeRes();
    const { req, next } = makeReqNext();
    errorHandler(err, req, res, next);
    expect(res.status().json).toHaveBeenCalledWith(expect.objectContaining({ error: expect.objectContaining({ code: 'INTERNAL_ERROR' }) }));
  });

  it('pgCode 23503 (foreign_key_violation) → 400 INVALID_REFERENCE', () => {
    const err = Object.assign(new Error('fk'), { code: '23503' });
    const res = makeRes();
    const { req, next } = makeReqNext();
    errorHandler(err as any, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.status().json).toHaveBeenCalledWith({ error: { code: 'INVALID_REFERENCE', message: 'Referenced resource does not exist' } });
  });

  it('pgCode 23505 (unique_violation) → 409 DUPLICATE_ENTRY', () => {
    const err = Object.assign(new Error('dup'), { code: '23505' });
    const res = makeRes();
    const { req, next } = makeReqNext();
    errorHandler(err as any, req, res, next);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('pgCode 22P02 (invalid UUID) → 400 VALIDATION_ERROR', () => {
    const err = Object.assign(new Error('uuid'), { code: '22P02' });
    const res = makeRes();
    const { req, next } = makeReqNext();
    errorHandler(err as any, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.status().json).toHaveBeenCalledWith({ error: { code: 'VALIDATION_ERROR', message: 'Invalid ID format' } });
  });

  it('Prisma P2025 → 404 NOT_FOUND', () => {
    const err = Object.assign(new Error('rec'), { name: 'PrismaClientKnownRequestError', code: 'P2025' });
    const res = makeRes();
    const { req, next } = makeReqNext();
    errorHandler(err as any, req, res, next);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it('Prisma P2002 → 409 DUPLICATE_ENTRY', () => {
    const err = Object.assign(new Error('dup'), { name: 'PrismaClientKnownRequestError', code: 'P2002' });
    const res = makeRes();
    const { req, next } = makeReqNext();
    errorHandler(err as any, req, res, next);
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it('Prisma P2003 → 400 INVALID_REFERENCE', () => {
    const err = Object.assign(new Error('fk'), { name: 'PrismaClientKnownRequestError', code: 'P2003' });
    const res = makeRes();
    const { req, next } = makeReqNext();
    errorHandler(err as any, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('Prisma P2022 → 400 VALIDATION_ERROR', () => {
    const err = Object.assign(new Error('v'), { name: 'PrismaClientKnownRequestError', code: 'P2022' });
    const res = makeRes();
    const { req, next } = makeReqNext();
    errorHandler(err as any, req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.status().json).toHaveBeenCalledWith({ error: { code: 'VALIDATION_ERROR', message: 'v' } });
  });

  it('Prisma P2023 → 400 VALIDATION_ERROR invalid ID format', () => {
    const err = Object.assign(new Error('id'), { name: 'PrismaClientKnownRequestError', code: 'P2023' });
    const res = makeRes();
    const { req, next } = makeReqNext();
    errorHandler(err as any, req, res, next);
    expect(res.status().json).toHaveBeenCalledWith({ error: { code: 'VALIDATION_ERROR', message: 'Invalid ID format' } });
  });

  it('unknown error → 500 INTERNAL_ERROR', () => {
    const err = new Error('unknown');
    const res = makeRes();
    const { req, next } = makeReqNext();
    errorHandler(err as any, req, res, next);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });
});

describe('asyncHandler', () => {
  it('passes resolved promise result through', async () => {
    const handler = asyncHandler(async (_req, res) => {
      res.json({ ok: true });
    });
    const res = { json: vi.fn() } as any;
    const next = vi.fn();
    await handler({} as any, res, next);
    expect(res.json).toHaveBeenCalledWith({ ok: true });
    expect(next).not.toHaveBeenCalled();
  });

  it('passes rejected promise to next', async () => {
    const err = new Error('handler error');
    const handler = asyncHandler(async () => { throw err; });
    const next = vi.fn();
    await handler({} as any, {} as any, next);
    expect(next).toHaveBeenCalledWith(err);
  });
});
