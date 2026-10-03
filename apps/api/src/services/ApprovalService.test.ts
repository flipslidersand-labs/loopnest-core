import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApprovalService } from './ApprovalService.js';
import { ApiErrorResponse } from '../middleware/errorHandler.js';

// ---------------------------------------------------------------------------
// Minimal in-memory Kysely-shaped fake. Supports exactly the query shapes
// ApprovalService uses: selectFrom/selectAll/select/where(eb.and/eb)/forUpdate/
// orderBy/execute*, insertInto/values/execute, updateTable/set/where/execute*,
// and transaction().execute(fn).
// ---------------------------------------------------------------------------
type Row = Record<string, any>;

function matchWhere(row: Row, expr: any): boolean {
  if (!expr) return true;
  if (expr.and) return expr.and.every((e: any) => matchWhere(row, e));
  if (expr.or) return expr.or.some((e: any) => matchWhere(row, e));
  return row[expr.col] === expr.val;
}

function makeEb() {
  const eb: any = (col: string, _op: string, val: any) => ({ col, val });
  eb.and = (exprs: any[]) => ({ and: exprs });
  eb.or = (exprs: any[]) => ({ or: exprs });
  return eb;
}

class SelectBuilder {
  private whereExpr: any = null;
  private orderCol?: string;
  private orderDir?: string;
  constructor(
    private tables: Record<string, Row[]>,
    private table: string,
  ) {}
  selectAll() {
    return this;
  }
  select(_col: string) {
    return this;
  }
  where(cb: (eb: any) => any) {
    this.whereExpr = cb(makeEb());
    return this;
  }
  forUpdate() {
    return this;
  }
  orderBy(col: string, dir: string) {
    this.orderCol = col;
    this.orderDir = dir;
    return this;
  }
  private rows() {
    let rows = (this.tables[this.table] || []).filter((r) => matchWhere(r, this.whereExpr));
    if (this.orderCol) {
      const col = this.orderCol;
      rows = [...rows].sort((a, b) => {
        const cmp = a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0;
        return this.orderDir === 'desc' ? -cmp : cmp;
      });
    }
    return rows;
  }
  async execute() {
    return this.rows();
  }
  async executeTakeFirst() {
    return this.rows()[0];
  }
  async executeTakeFirstOrThrow() {
    const r = this.rows()[0];
    if (!r) throw new Error('not found');
    return r;
  }
}

class InsertBuilder {
  private row: Row = {};
  constructor(
    private tables: Record<string, Row[]>,
    private table: string,
  ) {}
  values(v: Row) {
    this.row = v;
    return this;
  }
  async execute() {
    if (!this.tables[this.table]) this.tables[this.table] = [];
    this.tables[this.table].push({ ...this.row });
    return [];
  }
}

class UpdateBuilder {
  private setValues: Row = {};
  private whereExpr: any = null;
  constructor(
    private tables: Record<string, Row[]>,
    private table: string,
  ) {}
  set(v: Row) {
    this.setValues = v;
    return this;
  }
  where(cb: (eb: any) => any) {
    this.whereExpr = cb(makeEb());
    return this;
  }
  private matching() {
    return (this.tables[this.table] || []).filter((r) => matchWhere(r, this.whereExpr));
  }
  async execute() {
    const rows = this.matching();
    for (const r of rows) Object.assign(r, this.setValues);
    return rows;
  }
  async executeTakeFirst() {
    const rows = this.matching();
    for (const r of rows) Object.assign(r, this.setValues);
    return { numUpdatedRows: BigInt(rows.length) };
  }
}

class FakeDb {
  constructor(private tables: Record<string, Row[]>) {}
  selectFrom(table: string) {
    return new SelectBuilder(this.tables, table);
  }
  insertInto(table: string) {
    return new InsertBuilder(this.tables, table);
  }
  updateTable(table: string) {
    return new UpdateBuilder(this.tables, table);
  }
  transaction() {
    return { execute: (fn: (trx: any) => Promise<any>) => fn(this) };
  }
}

const REQUESTS = 'workflow.approval_requests';
const STEPS = 'workflow.approval_steps';

function makeQuote(overrides: Record<string, any> = {}) {
  return { id: 'q-1', status: 'pending_approval', subtotalAmount: 500, ...overrides };
}

function makeService(tables: Record<string, Row[]> = {}, quote: any = makeQuote()) {
  const db = new FakeDb({ [REQUESTS]: [], [STEPS]: [], ...tables });
  const repos = { quotes: { findById: vi.fn().mockResolvedValue(quote) } };
  const svc = new ApprovalService(repos as any, db as any);
  return { svc, db, repos };
}

describe('ApprovalService.createApprovalRequest', () => {
  it('rejects an empty approverUserIds array with 400', async () => {
    const { svc } = makeService();
    await expect(svc.createApprovalRequest('q-1', [])).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects when the quote does not exist (404)', async () => {
    const { svc } = makeService({}, null as any);
    await expect(svc.createApprovalRequest('missing', ['u1'])).rejects.toMatchObject({ statusCode: 404 });
  });

  it('rejects when the quote is not pending_approval (409)', async () => {
    const { svc } = makeService({}, makeQuote({ status: 'draft' }));
    await expect(svc.createApprovalRequest('q-1', ['u1'])).rejects.toMatchObject({ statusCode: 409 });
  });

  it('rejects when a pending approval request already exists for the quote (409)', async () => {
    const { svc } = makeService({
      [REQUESTS]: [{ id: 'existing', quote_id: 'q-1', status: 'pending' }],
    });
    await expect(svc.createApprovalRequest('q-1', ['u1'])).rejects.toMatchObject({ statusCode: 409 });
  });

  it('routes as standard when totalAmount is at or below 100000', async () => {
    const { svc, db } = makeService({}, makeQuote({ subtotalAmount: 100000 }));
    await svc.createApprovalRequest('q-1', ['u1']);
    const stored = await db.selectFrom(REQUESTS).selectAll().executeTakeFirst();
    expect(stored.route_type).toBe('standard');
  });

  it('routes as high_value when totalAmount exceeds 100000', async () => {
    const { svc, db } = makeService({}, makeQuote({ subtotalAmount: 100001 }));
    await svc.createApprovalRequest('q-1', ['u1']);
    const stored = await db.selectFrom(REQUESTS).selectAll().executeTakeFirst();
    expect(stored.route_type).toBe('high_value');
  });

  it('creates one step per approver', async () => {
    const { svc, db } = makeService();
    const result = await svc.createApprovalRequest('q-1', ['u1', 'u2', 'u3']);
    expect(result.steps).toHaveLength(3);
    const steps = await db.selectFrom(STEPS).selectAll().execute();
    expect(steps).toHaveLength(3);
  });
});

describe('ApprovalService.approveStep / rejectStep — loadDecidableStep branches', () => {
  function seeded() {
    return {
      [REQUESTS]: [{ id: 'req-1', quote_id: 'q-1', status: 'pending', total_amount: '100' }],
      [STEPS]: [
        { id: 'step-1', approval_request_id: 'req-1', step_order: 1, approver_id: 'alice', status: 'pending' },
      ],
    };
  }

  it('404s when the approval request does not exist', async () => {
    const { svc } = makeService({ [REQUESTS]: [], [STEPS]: seeded()[STEPS] });
    await expect(svc.approveStep('missing', 'step-1', 'alice')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('409s when the approval request is not pending', async () => {
    const tables = seeded();
    tables[REQUESTS][0].status = 'approved';
    const { svc } = makeService(tables);
    await expect(svc.approveStep('req-1', 'step-1', 'alice')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('404s when the step does not exist', async () => {
    const { svc } = makeService(seeded());
    await expect(svc.approveStep('req-1', 'missing-step', 'alice')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('409s when the step is already decided', async () => {
    const tables = seeded();
    tables[STEPS][0].status = 'approved';
    const { svc } = makeService(tables);
    await expect(svc.approveStep('req-1', 'step-1', 'alice')).rejects.toMatchObject({ statusCode: 409 });
  });

  it('403s when a different user tries to decide the step', async () => {
    const { svc } = makeService(seeded());
    await expect(svc.approveStep('req-1', 'step-1', 'bob')).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('ApprovalService.approveStep — request completion', () => {
  it('leaves the request pending when other steps are still pending', async () => {
    const tables = {
      [REQUESTS]: [{ id: 'req-1', quote_id: 'q-1', status: 'pending' }],
      [STEPS]: [
        { id: 'step-1', approval_request_id: 'req-1', step_order: 1, approver_id: 'alice', status: 'pending' },
        { id: 'step-2', approval_request_id: 'req-1', step_order: 2, approver_id: 'bob', status: 'pending' },
      ],
    };
    const { svc, db } = makeService(tables);
    await svc.approveStep('req-1', 'step-1', 'alice');
    const req = await db.selectFrom(REQUESTS).selectAll().executeTakeFirst();
    expect(req.status).toBe('pending');
  });

  it('marks the request approved once the last pending step is approved', async () => {
    const tables = {
      [REQUESTS]: [{ id: 'req-1', quote_id: 'q-1', status: 'pending' }],
      [STEPS]: [
        { id: 'step-1', approval_request_id: 'req-1', step_order: 1, approver_id: 'alice', status: 'approved' },
        { id: 'step-2', approval_request_id: 'req-1', step_order: 2, approver_id: 'bob', status: 'pending' },
      ],
    };
    const { svc, db } = makeService(tables);
    await svc.approveStep('req-1', 'step-2', 'bob');
    const req = await db.selectFrom(REQUESTS).selectAll().executeTakeFirst();
    expect(req.status).toBe('approved');
  });
});

describe('ApprovalService.rejectStep', () => {
  it('requires a reason (400)', async () => {
    const { svc } = makeService();
    await expect(svc.rejectStep('req-1', 'step-1', 'alice', '')).rejects.toMatchObject({ statusCode: 400 });
  });

  it('rejects the whole request on a single step rejection', async () => {
    const tables = {
      [REQUESTS]: [{ id: 'req-1', quote_id: 'q-1', status: 'pending' }],
      [STEPS]: [
        { id: 'step-1', approval_request_id: 'req-1', step_order: 1, approver_id: 'alice', status: 'pending' },
        { id: 'step-2', approval_request_id: 'req-1', step_order: 2, approver_id: 'bob', status: 'pending' },
      ],
    };
    const { svc, db } = makeService(tables);
    await svc.rejectStep('req-1', 'step-1', 'alice', 'price too high');
    const req = await db.selectFrom(REQUESTS).selectAll().executeTakeFirst();
    expect(req.status).toBe('rejected');
  });
});

describe('ApprovalService.cancelApprovalRequest', () => {
  it('cancels a pending request', async () => {
    const { svc, db } = makeService({
      [REQUESTS]: [{ id: 'req-1', quote_id: 'q-1', status: 'pending' }],
    });
    await svc.cancelApprovalRequest('req-1', 'alice');
    const req = await db.selectFrom(REQUESTS).selectAll().executeTakeFirst();
    expect(req.status).toBe('cancelled');
  });

  it('404s when the request does not exist', async () => {
    const { svc } = makeService();
    await expect(svc.cancelApprovalRequest('missing', 'alice')).rejects.toMatchObject({ statusCode: 404 });
  });

  it('409s when the request is no longer pending (already decided)', async () => {
    const { svc } = makeService({
      [REQUESTS]: [{ id: 'req-1', quote_id: 'q-1', status: 'approved' }],
    });
    await expect(svc.cancelApprovalRequest('req-1', 'alice')).rejects.toMatchObject({ statusCode: 409 });
  });
});
