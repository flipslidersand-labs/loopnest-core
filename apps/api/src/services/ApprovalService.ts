import { RepositoryContainer } from '@loopnest/bizcore-db';
import type { QuoteEntity, KyselyDatabase, ApprovalStepRow, Kysely } from '@loopnest/bizcore-db';
import { ApiErrorResponse } from '../middleware/errorHandler.js';
import { v4 as uuidv4 } from 'uuid';

export interface ApprovalStep {
  id: string;
  approvalRequestId: string;
  stepNumber: number;
  approverUserId: string;
  status: 'pending' | 'approved' | 'rejected';
  notes?: string;
  decidedAt?: Date;
}

export interface ApprovalRequest {
  id: string;
  quoteId: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  steps: ApprovalStep[];
  createdAt: Date;
  completedAt?: Date;
}

const REQUESTS = 'workflow.approval_requests';
const STEPS = 'workflow.approval_steps';

/**
 * Multi-step approval workflow. Backed by Kysely (schema-qualified table names),
 * the same query builder the rest of the data layer uses. An approval request
 * has N steps (one per approver); the request completes 'approved' only when all
 * steps are approved, and flips to 'rejected' the moment any step is rejected.
 */
export class ApprovalService {
  constructor(
    private repos: RepositoryContainer,
    private db: Kysely<KyselyDatabase>
  ) {}

  async createApprovalRequest(
    quoteId: string,
    approverUserIds: string[]
  ): Promise<ApprovalRequest> {
    if (!approverUserIds || approverUserIds.length === 0) {
      throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'At least one approver is required');
    }

    const quote = await this.repos.quotes.findById(quoteId);
    if (!quote) {
      throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
    }
    if (quote.status !== 'pending_approval') {
      throw new ApiErrorResponse(
        409,
        'INVALID_STATUS',
        `Cannot create approval request for quote with status ${quote.status}. Must be pending_approval.`
      );
    }

    // One open approval request per quote.
    const existing = await this.db
      .selectFrom(REQUESTS)
      .selectAll()
      .where((eb) => eb.and([eb('quote_id', '=', quoteId), eb('status', '=', 'pending')]))
      .executeTakeFirst();
    if (existing) {
      throw new ApiErrorResponse(
        409,
        'ALREADY_EXISTS',
        'An approval request is already pending for this quote'
      );
    }

    const approvalRequestId = uuidv4();
    const totalAmount = quote.subtotalAmount ? Number(quote.subtotalAmount) : 0;
    const now = new Date();
    const steps: ApprovalStep[] = approverUserIds.map((userId, index) => ({
      id: uuidv4(),
      approvalRequestId,
      stepNumber: index + 1,
      approverUserId: userId,
      status: 'pending',
    }));

    // Request + steps must be created atomically, or a failure mid-loop would
    // leave an orphaned request row with missing steps.
    await this.db.transaction().execute(async (trx) => {
      await trx
        .insertInto(REQUESTS)
        .values({
          id: approvalRequestId,
          quote_id: quoteId,
          total_amount: totalAmount.toString(),
          route_type: totalAmount > 100000 ? 'high_value' : 'standard',
          status: 'pending',
          created_at: now,
        })
        .execute();

      for (const step of steps) {
        await trx
          .insertInto(STEPS)
          .values({
            id: step.id,
            approval_request_id: approvalRequestId,
            step_order: step.stepNumber,
            approver_id: step.approverUserId,
            status: 'pending',
            approved_at: null,
            comment: null,
          })
          .execute();
      }
    });

    return { id: approvalRequestId, quoteId, status: 'pending', steps, createdAt: now };
  }

  /**
   * Load a step and its parent request within a transaction, enforcing common
   * preconditions. Callers MUST pass the transaction (`trx`) so that the
   * FOR UPDATE lock is held until the surrounding transaction commits.
   */
  private async loadDecidableStep(
    trx: Kysely<KyselyDatabase>,
    approvalRequestId: string,
    stepId: string,
    userId: string
  ) {
    // FOR UPDATE locks the request row so concurrent decisions serialize.
    const request = await trx
      .selectFrom(REQUESTS)
      .selectAll()
      .where((eb) => eb('id', '=', approvalRequestId))
      .forUpdate()
      .executeTakeFirst();
    if (!request) {
      throw new ApiErrorResponse(404, 'NOT_FOUND', 'Approval request not found');
    }
    if (request.status !== 'pending') {
      throw new ApiErrorResponse(
        409,
        'INVALID_STATUS',
        `Approval request is already ${request.status}`
      );
    }

    // FOR UPDATE locks the step row to prevent a double-decide on the same step.
    const step = await trx
      .selectFrom(STEPS)
      .selectAll()
      .where((eb) =>
        eb.and([eb('id', '=', stepId), eb('approval_request_id', '=', approvalRequestId)])
      )
      .forUpdate()
      .executeTakeFirst();
    if (!step) {
      throw new ApiErrorResponse(404, 'NOT_FOUND', 'Approval step not found');
    }
    if (step.status !== 'pending') {
      throw new ApiErrorResponse(409, 'INVALID_STATUS', `Step is already ${step.status}`);
    }
    if (step.approver_id !== userId) {
      throw new ApiErrorResponse(
        403,
        'FORBIDDEN',
        'This step is assigned to a different approver'
      );
    }
    return { request, step };
  }

  async approveStep(
    approvalRequestId: string,
    stepId: string,
    userId: string,
    notes?: string
  ): Promise<ApprovalStep> {
    const now = new Date();
    let stepOrder: number;

    await this.db.transaction().execute(async (trx) => {
      const { step } = await this.loadDecidableStep(trx, approvalRequestId, stepId, userId);
      stepOrder = step.step_order;

      await trx
        .updateTable(STEPS)
        .set({ status: 'approved', approved_at: now, comment: notes || null })
        .where((eb) => eb('id', '=', stepId))
        .execute();

      // If no steps remain pending, the whole request is approved.
      const remaining = await trx
        .selectFrom(STEPS)
        .select('id')
        .where((eb) =>
          eb.and([eb('approval_request_id', '=', approvalRequestId), eb('status', '=', 'pending')])
        )
        .execute();

      if (remaining.length === 0) {
        await trx
          .updateTable(REQUESTS)
          .set({ status: 'approved', completed_at: now })
          .where((eb) => eb('id', '=', approvalRequestId))
          .execute();
      }
    });

    return {
      id: stepId,
      approvalRequestId,
      stepNumber: stepOrder!,
      approverUserId: userId,
      status: 'approved',
      notes,
      decidedAt: now,
    };
  }

  async rejectStep(
    approvalRequestId: string,
    stepId: string,
    userId: string,
    reason: string
  ): Promise<ApprovalStep> {
    if (!reason) {
      throw new ApiErrorResponse(400, 'VALIDATION_ERROR', 'reason is required');
    }
    const now = new Date();
    let stepOrder: number;

    await this.db.transaction().execute(async (trx) => {
      const { step } = await this.loadDecidableStep(trx, approvalRequestId, stepId, userId);
      stepOrder = step.step_order;

      await trx
        .updateTable(STEPS)
        .set({ status: 'rejected', approved_at: now, comment: reason })
        .where((eb) => eb('id', '=', stepId))
        .execute();

      // Any rejection rejects the whole request.
      await trx
        .updateTable(REQUESTS)
        .set({ status: 'rejected', completed_at: now })
        .where((eb) => eb('id', '=', approvalRequestId))
        .execute();
    });

    return {
      id: stepId,
      approvalRequestId,
      stepNumber: stepOrder!,
      approverUserId: userId,
      status: 'rejected',
      notes: `Rejected: ${reason}`,
      decidedAt: now,
    };
  }

  async getApprovalStatus(quoteId: string): Promise<{
    quote: QuoteEntity;
    approvalRequest?: ApprovalRequest;
    progress: {
      totalSteps: number;
      completedSteps: number;
      pendingSteps: number;
      approvalPercentage: number;
    };
  }> {
    const quote = await this.repos.quotes.findById(quoteId);
    if (!quote) {
      throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
    }

    const approvalRequest = await this.db
      .selectFrom(REQUESTS)
      .selectAll()
      .where((eb) => eb('quote_id', '=', quoteId))
      .orderBy('created_at', 'desc')
      .executeTakeFirst();

    if (!approvalRequest) {
      return {
        quote,
        progress: { totalSteps: 0, completedSteps: 0, pendingSteps: 0, approvalPercentage: 0 },
      };
    }

    const steps = await this.db
      .selectFrom(STEPS)
      .selectAll()
      .where((eb) => eb('approval_request_id', '=', approvalRequest.id))
      .orderBy('step_order', 'asc')
      .execute();

    const completedSteps = steps.filter((s) => s.status !== 'pending').length;
    const totalSteps = steps.length;

    return {
      quote,
      approvalRequest: {
        id: approvalRequest.id,
        quoteId,
        status: approvalRequest.status as 'pending' | 'approved' | 'rejected' | 'cancelled',
        steps: steps.map((s) => this.mapStep(approvalRequest.id, s)),
        createdAt: approvalRequest.created_at,
        completedAt: approvalRequest.completed_at ?? undefined,
      },
      progress: {
        totalSteps,
        completedSteps,
        pendingSteps: totalSteps - completedSteps,
        approvalPercentage:
          totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0,
      },
    };
  }

  async cancelApprovalRequest(approvalRequestId: string, _userId: string): Promise<void> {
    // Conditional UPDATE is atomic: only one concurrent caller can flip
    // status from 'pending' → 'cancelled'; others see rowCount=0 and get 409.
    const result = await this.db
      .updateTable(REQUESTS)
      .set({ status: 'cancelled', completed_at: new Date() })
      .where((eb) =>
        eb.and([eb('id', '=', approvalRequestId), eb('status', '=', 'pending')])
      )
      .executeTakeFirst();

    if (!result || result.numUpdatedRows === BigInt(0)) {
      const existing = await this.db
        .selectFrom(REQUESTS)
        .select('status')
        .where((eb) => eb('id', '=', approvalRequestId))
        .executeTakeFirst();
      if (!existing) {
        throw new ApiErrorResponse(404, 'NOT_FOUND', 'Approval request not found');
      }
      throw new ApiErrorResponse(
        409,
        'INVALID_STATUS',
        `Cannot cancel an approval request that is already ${existing.status}`
      );
    }
  }

  async getPendingApprovalsForUser(userId: string): Promise<ApprovalRequest[]> {
    const steps = await this.db
      .selectFrom(STEPS)
      .selectAll()
      .where((eb) =>
        eb.and([eb('approver_id', '=', userId), eb('status', '=', 'pending')])
      )
      .execute();

    const requestIds = [...new Set(steps.map((s) => s.approval_request_id))] as string[];

    return Promise.all(
      requestIds.map(async (id) => {
        const request = await this.db
          .selectFrom(REQUESTS)
          .selectAll()
          .where((eb) => eb('id', '=', id))
          .executeTakeFirst();
        // requestId was derived from steps rows, so the parent request must exist.
        if (!request) throw new ApiErrorResponse(404, 'NOT_FOUND', `Approval request ${id} not found`);
        const allSteps = await this.db
          .selectFrom(STEPS)
          .selectAll()
          .where((eb) => eb('approval_request_id', '=', id))
          .orderBy('step_order', 'asc')
          .execute();
        return {
          id: request.id,
          quoteId: request.quote_id,
          status: request.status as 'pending' | 'approved' | 'rejected' | 'cancelled',
          steps: allSteps.map((s) => this.mapStep(request.id, s)),
          createdAt: request.created_at,
          completedAt: request.completed_at ?? undefined,
        };
      })
    );
  }

  private mapStep(approvalRequestId: string, s: ApprovalStepRow): ApprovalStep {
    return {
      id: s.id,
      approvalRequestId,
      stepNumber: s.step_order,
      approverUserId: s.approver_id,
      status: s.status as 'pending' | 'approved' | 'rejected',
      notes: s.comment ?? undefined,
      decidedAt: s.approved_at ?? undefined,
    };
  }
}
