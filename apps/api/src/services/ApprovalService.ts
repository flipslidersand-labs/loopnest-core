import { RepositoryContainer } from '@loopnest/bizcore-db';
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

export class ApprovalService {
  constructor(
    private repos: RepositoryContainer,
    private drizzleDb: any
  ) {}

  /**
   * Create approval request for a quote
   */
  async createApprovalRequest(
    quoteId: string,
    approverUserIds: string[]
  ): Promise<ApprovalRequest> {
    const quote = await this.repos.quotes.findById(quoteId);

    if (!quote) {
      throw new ApiErrorResponse(404, 'NOT_FOUND', 'Quote not found');
    }

    if (quote.status !== 'pending_approval') {
      throw new ApiErrorResponse(
        400,
        'INVALID_STATUS',
        `Cannot create approval request for quote with status ${quote.status}.`
      );
    }

    const approvalRequestId = uuidv4();

    const subtotalAmount = quote.subtotalAmount ? parseFloat(quote.subtotalAmount.toString()) : 0;
    await this.drizzleDb
      .insertInto('approval_requests')
      .values({
        id: approvalRequestId,
        quote_id: quoteId,
        total_amount: subtotalAmount.toString(),
        route_type: subtotalAmount > 100000 ? 'high_value' : 'standard',
        status: 'pending',
        created_at: new Date(),
      })
      .execute();

    const steps: ApprovalStep[] = [];
    for (const [index, userId] of approverUserIds.entries()) {
      const stepId = uuidv4();
      await this.drizzleDb
        .insertInto('approval_steps')
        .values({
          id: stepId,
          approval_request_id: approvalRequestId,
          step_order: index + 1,
          approver_id: userId,
          status: 'pending',
          approved_at: null,
          comment: null,
        })
        .execute();

      steps.push({
        id: stepId,
        approvalRequestId,
        stepNumber: index + 1,
        approverUserId: userId,
        status: 'pending',
      });
    }

    return {
      id: approvalRequestId,
      quoteId,
      status: 'pending',
      steps,
      createdAt: new Date(),
    };
  }

  /**
   * Approve a step in the approval workflow
   */
  async approveStep(
    approvalRequestId: string,
    stepId: string,
    userId: string,
    notes?: string
  ): Promise<ApprovalStep> {
    const now = new Date();

    const step = await this.drizzleDb
      .selectFrom('approval_steps')
      .selectAll()
      .where((eb: any) => eb('id', '=', stepId))
      .executeTakeFirst();

    if (!step) {
      throw new ApiErrorResponse(404, 'NOT_FOUND', 'Approval step not found');
    }

    await this.drizzleDb
      .updateTable('approval_steps')
      .set({
        status: 'approved',
        approved_at: now,
        comment: notes || null,
      })
      .where((eb: any) => eb('id', '=', stepId))
      .execute();

    const remainingSteps = await this.drizzleDb
      .selectFrom('approval_steps')
      .selectAll()
      .where((eb: any) =>
        eb.and([
          eb('approval_request_id', '=', approvalRequestId),
          eb('status', '=', 'pending'),
        ])
      )
      .execute();

    if (remainingSteps.length === 0) {
      await this.drizzleDb
        .updateTable('approval_requests')
        .set({
          status: 'approved',
          completed_at: now,
        })
        .where((eb: any) => eb('id', '=', approvalRequestId))
        .execute();
    }

    return {
      id: stepId,
      approvalRequestId,
      stepNumber: step.step_order,
      approverUserId: userId,
      status: 'approved',
      notes,
      decidedAt: now,
    };
  }

  /**
   * Reject a step in the approval workflow
   */
  async rejectStep(
    approvalRequestId: string,
    stepId: string,
    userId: string,
    reason: string
  ): Promise<ApprovalStep> {
    const now = new Date();

    const step = await this.drizzleDb
      .selectFrom('approval_steps')
      .selectAll()
      .where((eb: any) => eb('id', '=', stepId))
      .executeTakeFirst();

    if (!step) {
      throw new ApiErrorResponse(404, 'NOT_FOUND', 'Approval step not found');
    }

    await this.drizzleDb
      .updateTable('approval_steps')
      .set({
        status: 'rejected',
        approved_at: now,
        comment: reason,
      })
      .where((eb: any) => eb('id', '=', stepId))
      .execute();

    await this.drizzleDb
      .updateTable('approval_requests')
      .set({
        status: 'rejected',
        completed_at: now,
      })
      .where((eb: any) => eb('id', '=', approvalRequestId))
      .execute();

    return {
      id: stepId,
      approvalRequestId,
      stepNumber: step.step_order,
      approverUserId: userId,
      status: 'rejected',
      notes: `Rejected: ${reason}`,
      decidedAt: now,
    };
  }

  /**
   * Get approval status for a quote
   */
  async getApprovalStatus(quoteId: string): Promise<{
    quote: any;
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

    const approvalRequest = await this.drizzleDb
      .selectFrom('approval_requests')
      .selectAll()
      .where((eb: any) => eb('quote_id', '=', quoteId))
      .executeTakeFirst();

    if (!approvalRequest) {
      return {
        quote,
        progress: {
          totalSteps: 0,
          completedSteps: 0,
          pendingSteps: 0,
          approvalPercentage: 0,
        },
      };
    }

    const steps = await this.drizzleDb
      .selectFrom('approval_steps')
      .selectAll()
      .where((eb: any) => eb('approval_request_id', '=', approvalRequest.id))
      .execute();

    const completedSteps = steps.filter((s: any) => s.status !== 'pending').length;
    const totalSteps = steps.length;

    return {
      quote,
      approvalRequest: {
        id: approvalRequest.id,
        quoteId,
        status: approvalRequest.status,
        steps: steps.map((s: any) => ({
          id: s.id,
          approvalRequestId: approvalRequest.id,
          stepNumber: s.step_order,
          approverUserId: s.approver_id,
          status: s.status,
          notes: s.comment,
          decidedAt: s.approved_at,
        })),
        createdAt: approvalRequest.created_at,
        completedAt: approvalRequest.completed_at,
      },
      progress: {
        totalSteps,
        completedSteps,
        pendingSteps: totalSteps - completedSteps,
        approvalPercentage: totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0,
      },
    };
  }

  /**
   * Cancel approval request
   */
  async cancelApprovalRequest(approvalRequestId: string, userId: string): Promise<void> {
    await this.drizzleDb
      .updateTable('approval_requests')
      .set({
        status: 'cancelled',
        completed_at: new Date(),
      })
      .where((eb: any) => eb('id', '=', approvalRequestId))
      .execute();
  }

  /**
   * Get pending approvals for a user
   */
  async getPendingApprovalsForUser(userId: string): Promise<ApprovalRequest[]> {
    const steps = await this.drizzleDb
      .selectFrom('approval_steps')
      .selectAll()
      .where((eb: any) =>
        eb.and([
          eb('approver_id', '=', userId),
          eb('status', '=', 'pending'),
        ])
      )
      .execute();

    const approvalRequestIds = [...new Set(steps.map((s: any) => s.approval_request_id))] as string[];

    const requests = await Promise.all(
      approvalRequestIds.map(async (id) => {
        const request = await this.drizzleDb
          .selectFrom('approval_requests')
          .selectAll()
          .where((eb: any) => eb('id', '=', id))
          .executeTakeFirst();

        const allSteps = await this.drizzleDb
          .selectFrom('approval_steps')
          .selectAll()
          .where((eb: any) => eb('approval_request_id', '=', id))
          .execute();

        return {
          id: request.id,
          quoteId: request.quote_id,
          status: request.status,
          steps: allSteps.map((s: any) => ({
            id: s.id,
            approvalRequestId: request.id,
            stepNumber: s.step_order,
            approverUserId: s.approver_id,
            status: s.status,
            notes: s.comment,
            decidedAt: s.approved_at,
          })),
          createdAt: request.created_at,
          completedAt: request.completed_at,
        };
      })
    );

    return requests;
  }
}
