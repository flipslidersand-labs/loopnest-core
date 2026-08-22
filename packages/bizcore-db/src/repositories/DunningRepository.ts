import { randomUUID } from 'crypto';

export type DunningAction = 'reminder' | 'warning' | 'suspend' | 'collection';

export interface DunningRule {
  id: string;
  name: string;
  daysOverdue: number;
  action: DunningAction;
  messageTemplate: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateDunningRuleInput {
  name: string;
  daysOverdue: number;
  action?: DunningAction;
  messageTemplate?: string;
}

export interface DunningLog {
  id: string;
  invoiceId: string;
  ruleId: string;
  daysOverdue: number;
  action: DunningAction;
  sentAt: Date;
}

export class DunningRepository {
  constructor(private db: any) {}

  // ── Rules ────────────────────────────────────────────────────────────────────

  async findAllRules(activeOnly = false): Promise<DunningRule[]> {
    let q = this.db
      .selectFrom('core.dunning_rules')
      .selectAll()
      .orderBy('days_overdue', 'asc');
    if (activeOnly) q = q.where('is_active', '=', true);
    const rows = await q.execute();
    return rows.map((r: any) => this.mapRule(r));
  }

  async findRuleById(id: string): Promise<DunningRule | null> {
    const r = await this.db
      .selectFrom('core.dunning_rules')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    return r ? this.mapRule(r) : null;
  }

  async createRule(input: CreateDunningRuleInput): Promise<DunningRule> {
    const now = new Date();
    const r = await this.db
      .insertInto('core.dunning_rules')
      .values({
        id: randomUUID(),
        name: input.name,
        days_overdue: input.daysOverdue,
        action: input.action ?? 'reminder',
        message_template: input.messageTemplate ?? null,
        is_active: true,
        created_at: now,
        updated_at: now,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.mapRule(r);
  }

  async updateRule(id: string, patch: Partial<Pick<DunningRule, 'name' | 'messageTemplate' | 'isActive'>>): Promise<DunningRule | null> {
    const set: Record<string, unknown> = { updated_at: new Date() };
    if (patch.name !== undefined)            set.name = patch.name;
    if (patch.messageTemplate !== undefined) set.message_template = patch.messageTemplate;
    if (patch.isActive !== undefined)        set.is_active = patch.isActive;
    const r = await this.db
      .updateTable('core.dunning_rules')
      .set(set)
      .where('id', '=', id)
      .returningAll()
      .executeTakeFirst();
    return r ? this.mapRule(r) : null;
  }

  async deleteRule(id: string): Promise<boolean> {
    const result = await this.db
      .deleteFrom('core.dunning_rules')
      .where('id', '=', id)
      .executeTakeFirst();
    return Number(result?.numDeletedRows ?? 0) > 0;
  }

  // ── Logs ────────────────────────────────────────────────────────────────────

  async findLogsByInvoice(invoiceId: string): Promise<DunningLog[]> {
    const rows = await this.db
      .selectFrom('finance.dunning_logs')
      .selectAll()
      .where('invoice_id', '=', invoiceId)
      .orderBy('sent_at', 'asc')
      .execute();
    return rows.map((r: any) => this.mapLog(r));
  }

  /** Returns rules whose days_overdue <= daysOverdue and have NOT been logged yet for this invoice. */
  async findPendingRules(invoiceId: string, daysOverdue: number): Promise<DunningRule[]> {
    const rows = await this.db
      .selectFrom('core.dunning_rules as r')
      .selectAll('r')
      .where('r.is_active', '=', true)
      .where('r.days_overdue', '<=', daysOverdue)
      .where((eb: any) =>
        eb.not(
          eb.exists(
            eb.selectFrom('finance.dunning_logs as l')
              .select('l.id')
              .where('l.invoice_id', '=', invoiceId)
              .where('l.rule_id', '=', eb.ref('r.id'))
          )
        )
      )
      .orderBy('r.days_overdue', 'asc')
      .execute();
    return rows.map((r: any) => this.mapRule(r));
  }

  async recordLog(invoiceId: string, rule: DunningRule, daysOverdue: number): Promise<DunningLog> {
    const r = await this.db
      .insertInto('finance.dunning_logs')
      .values({
        id: randomUUID(),
        invoice_id: invoiceId,
        rule_id: rule.id,
        days_overdue: daysOverdue,
        action: rule.action,
        sent_at: new Date(),
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return this.mapLog(r);
  }

  private mapRule(r: any): DunningRule {
    return {
      id: r.id,
      name: r.name,
      daysOverdue: r.days_overdue,
      action: r.action as DunningAction,
      messageTemplate: r.message_template ?? null,
      isActive: r.is_active,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }

  private mapLog(r: any): DunningLog {
    return {
      id: r.id,
      invoiceId: r.invoice_id,
      ruleId: r.rule_id,
      daysOverdue: r.days_overdue,
      action: r.action as DunningAction,
      sentAt: r.sent_at,
    };
  }
}
