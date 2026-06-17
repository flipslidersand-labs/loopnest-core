/**
 * OpenAPI 3.0 description of the LoopNest Core API, built as a plain object so
 * it needs no codegen or decorators. Served as JSON at /openapi.json and
 * rendered by Swagger UI (CDN) at /docs.
 *
 * Conventions captured here:
 *  - Success responses wrap the payload in `{ "data": ... }`.
 *  - Errors use `{ "error": { "code": string, "message": string } }`.
 *  - Workflow state-change endpoints accept an optional `Idempotency-Key`
 *    header and are rate-limited (RateLimit-* / Retry-After headers).
 */

type Json = Record<string, any>;

// ---- reusable response/parameter builders -----------------------------------

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

const dataResp = (description: string, schema: Json) => ({
  description,
  content: { 'application/json': { schema: { type: 'object', properties: { data: schema } } } },
});

const errorResp = (description: string) => ({
  description,
  content: { 'application/json': { schema: ref('Error') } },
});

const STD_ERRORS = {
  '400': errorResp('Validation error'),
  '404': errorResp('Resource not found'),
  '500': errorResp('Unexpected error'),
};

const idParam = (name = 'id', desc = 'Resource id (UUID)') => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
  description: desc,
});

const pageParams = [
  { name: 'skip', in: 'query', schema: { type: 'integer', default: 0 }, description: 'Rows to skip' },
  { name: 'take', in: 'query', schema: { type: 'integer', default: 10 }, description: 'Page size' },
];

const idempotencyHeader = {
  name: 'Idempotency-Key',
  in: 'header',
  required: false,
  schema: { type: 'string' },
  description:
    'Optional. Replaying the same key with the same body returns the original response; a different body yields 422; an in-flight key yields 409.',
};

const body = (schema: Json, required = true) => ({
  required,
  content: { 'application/json': { schema } },
});

const obj = (properties: Json, required: string[] = []) => ({
  type: 'object',
  properties,
  ...(required.length ? { required } : {}),
});

const str = (extra: Json = {}) => ({ type: 'string', ...extra });
const num = (extra: Json = {}) => ({ type: 'number', ...extra });

// A simple CRUD path pair (collection + item) to cut repetition.
const crud = (
  tag: string,
  base: string,
  itemName: string,
  createSchema: Json,
  updateSchema: Json,
  listQuery: Json[] = pageParams
): Json => ({
  [base]: {
    get: {
      tags: [tag],
      summary: `List ${itemName}s`,
      parameters: listQuery,
      responses: { '200': dataResp(`Array of ${itemName}`, { type: 'array', items: ref(itemName) }) },
    },
    post: {
      tags: [tag],
      summary: `Create ${itemName}`,
      requestBody: body(createSchema),
      responses: { '201': dataResp(`Created ${itemName}`, ref(itemName)), ...STD_ERRORS },
    },
  },
  [`${base}/{id}`]: {
    get: {
      tags: [tag],
      summary: `Get ${itemName} by id`,
      parameters: [idParam()],
      responses: { '200': dataResp(itemName, ref(itemName)), '404': STD_ERRORS['404'] },
    },
    patch: {
      tags: [tag],
      summary: `Update ${itemName}`,
      parameters: [idParam()],
      requestBody: body(updateSchema),
      responses: { '200': dataResp(`Updated ${itemName}`, ref(itemName)), ...STD_ERRORS },
    },
    delete: {
      tags: [tag],
      summary: `Delete ${itemName}`,
      parameters: [idParam()],
      responses: { '200': { description: 'Deleted' }, '404': STD_ERRORS['404'] },
    },
  },
});

// ---- workflow helpers --------------------------------------------------------

const quoteAction = (action: string, summary: string, bodySchema: Json): Json => ({
  post: {
    tags: ['Workflow'],
    summary,
    parameters: [idParam('id', 'Quote id (UUID)'), idempotencyHeader],
    requestBody: body(bodySchema),
    responses: {
      '200': dataResp('Updated quote', ref('Quote')),
      '400': errorResp('Validation error'),
      '404': errorResp('Quote not found'),
      '409': errorResp('Invalid state transition'),
    },
  },
});

const stageList = (stage: string): Json => ({
  get: {
    tags: ['Workflow'],
    summary: `List quotes in stage "${stage}"`,
    parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 10 } }],
    responses: { '200': dataResp('Array of quotes', { type: 'array', items: ref('Quote') }) },
  },
});

// ---- document ---------------------------------------------------------------

export const openapiDocument: Json = {
  openapi: '3.0.3',
  info: {
    title: 'LoopNest Core API',
    version: '0.1.0',
    description:
      'BtoB Quote-to-Billing platform. Master-data CRUD, the quote workflow ' +
      '(draft → pending_approval → approved → invoiced), multi-step approvals, ' +
      'and invoice generation with a transactional outbox to an accounting system.\n\n' +
      'Success responses are wrapped in `{ data }`; errors in `{ error: { code, message } }`.',
  },
  servers: [{ url: 'http://localhost:3000', description: 'Local' }],
  tags: [
    { name: 'System', description: 'Health, readiness, metrics' },
    { name: 'Organizations' },
    { name: 'Customers' },
    { name: 'Products' },
    { name: 'Quotes' },
    { name: 'Users' },
    { name: 'Workflow', description: 'Quote state transitions' },
    { name: 'Approvals', description: 'Multi-step approval workflow' },
    { name: 'Payments', description: 'Payments & accounts receivable (M13)' },
  ],
  paths: {
    // System
    '/health': {
      get: {
        tags: ['System'],
        summary: 'Liveness probe',
        responses: { '200': { description: 'Process is up' } },
      },
    },
    '/ready': {
      get: {
        tags: ['System'],
        summary: 'Readiness probe (checks Postgres + Redis)',
        responses: {
          '200': { description: 'All dependencies reachable' },
          '503': { description: 'A dependency is unavailable' },
        },
      },
    },
    '/metrics': {
      get: {
        tags: ['System'],
        summary: 'Prometheus metrics',
        responses: { '200': { description: 'Metrics in text exposition format' } },
      },
    },

    // CRUD resources
    ...crud(
      'Organizations',
      '/api/organizations',
      'Organization',
      obj({ name: str(), type: str({ enum: ['company', 'department', 'division'] }), parentId: str({ nullable: true }) }, ['name', 'type']),
      obj({ name: str(), type: str(), parentId: str({ nullable: true }) })
    ),
    '/api/organizations/{id}/children': {
      get: {
        tags: ['Organizations'],
        summary: 'List child organizations',
        parameters: [idParam()],
        responses: { '200': dataResp('Array of organizations', { type: 'array', items: ref('Organization') }) },
      },
    },

    ...crud(
      'Customers',
      '/api/customers',
      'Customer',
      obj({ name: str(), address: str({ nullable: true }), phone: str({ nullable: true }) }, ['name']),
      obj({ name: str(), address: str({ nullable: true }), phone: str({ nullable: true }) })
    ),

    ...crud(
      'Products',
      '/api/products',
      'Product',
      obj({ sku: str(), name: str(), category: str({ enum: ['laptop', 'desktop', 'server', 'network'] }), unitPrice: num() }, ['sku', 'name', 'category', 'unitPrice']),
      obj({ name: str(), category: str(), unitPrice: num(), stockQuantity: num() })
    ),
    '/api/products/sku/{sku}': {
      get: {
        tags: ['Products'],
        summary: 'Get product by SKU',
        parameters: [{ name: 'sku', in: 'path', required: true, schema: str() }],
        responses: { '200': dataResp('Product', ref('Product')), '404': STD_ERRORS['404'] },
      },
    },

    ...crud(
      'Quotes',
      '/api/quotes',
      'Quote',
      obj(
        {
          quoteNumber: str(),
          customerId: str({ format: 'uuid' }),
          createdBy: str(),
          quoteRequestId: str({ format: 'uuid', nullable: true }),
          subtotalAmount: num(),
          taxAmount: num(),
          totalAmount: num(),
        },
        ['quoteNumber', 'customerId', 'createdBy']
      ),
      obj({ status: str(), subtotalAmount: num(), taxAmount: num(), totalAmount: num(), notes: str({ nullable: true }) }),
      [...pageParams,
        { name: 'status', in: 'query', schema: str() },
        { name: 'customerId', in: 'query', schema: str({ format: 'uuid' }) }]
    ),
    '/api/quotes/number/{quoteNumber}': {
      get: {
        tags: ['Quotes'],
        summary: 'Get quote by quote number',
        parameters: [{ name: 'quoteNumber', in: 'path', required: true, schema: str() }],
        responses: { '200': dataResp('Quote', ref('Quote')), '404': STD_ERRORS['404'] },
      },
    },

    ...crud(
      'Users',
      '/api/users',
      'User',
      obj(
        { name: str(), nameEn: str({ nullable: true }), email: str({ format: 'email' }), organizationId: str({ format: 'uuid' }), role: str({ enum: ['director', 'manager', 'senior', 'sales_rep'] }), profile: { type: 'object', nullable: true } },
        ['name', 'email', 'organizationId', 'role']
      ),
      obj({ name: str(), email: str(), organizationId: str(), role: str(), profile: { type: 'object', nullable: true } })
    ),
    '/api/users/email/{email}': {
      get: {
        tags: ['Users'],
        summary: 'Get user by email',
        parameters: [{ name: 'email', in: 'path', required: true, schema: str() }],
        responses: { '200': dataResp('User', ref('User')), '404': STD_ERRORS['404'] },
      },
    },

    // Workflow — quote transitions
    '/api/workflow/quotes/{id}/submit': quoteAction('submit', 'Submit a draft quote for approval', obj({ userId: str() }, ['userId'])),
    '/api/workflow/quotes/{id}/approve': quoteAction('approve', 'Approve a pending quote', obj({ userId: str(), notes: str() }, ['userId'])),
    '/api/workflow/quotes/{id}/reject': quoteAction('reject', 'Reject a pending quote', obj({ userId: str(), reason: str() }, ['userId', 'reason'])),
    '/api/workflow/quotes/{id}/invoice': quoteAction('invoice', 'Generate an invoice from an approved quote', obj({ userId: str() }, ['userId'])),
    '/api/workflow/quotes/{id}/status': {
      get: {
        tags: ['Workflow'],
        summary: 'Get a quote workflow status summary',
        parameters: [idParam('id', 'Quote id (UUID)')],
        responses: { '200': dataResp('Workflow status', ref('WorkflowStatus')), '404': STD_ERRORS['404'] },
      },
    },
    '/api/workflow/quotes/stage/draft': stageList('draft'),
    '/api/workflow/quotes/stage/pending-approval': stageList('pending_approval'),
    '/api/workflow/quotes/stage/approved': stageList('approved'),
    '/api/workflow/quotes/stage/invoiced': stageList('invoiced'),

    // Approvals
    '/api/workflow/approvals': {
      post: {
        tags: ['Approvals'],
        summary: 'Create an approval request for a pending_approval quote',
        parameters: [idempotencyHeader],
        requestBody: body(obj({ quoteId: str({ format: 'uuid' }), approverUserIds: { type: 'array', items: str() } }, ['quoteId', 'approverUserIds'])),
        responses: {
          '201': dataResp('Approval request', ref('ApprovalRequest')),
          '400': errorResp('Validation error'),
          '404': errorResp('Quote not found'),
          '409': errorResp('Quote not in pending_approval, or a request already exists'),
        },
      },
    },
    '/api/workflow/approvals/{requestId}/steps/{stepId}/approve': {
      post: {
        tags: ['Approvals'],
        summary: 'Approve a step (must be the assigned approver)',
        parameters: [idParam('requestId'), idParam('stepId')],
        requestBody: body(obj({ userId: str(), notes: str() }, ['userId'])),
        responses: {
          '200': dataResp('Updated step', ref('ApprovalStep')),
          '403': errorResp('Step assigned to a different approver'),
          '404': errorResp('Request or step not found'),
          '409': errorResp('Step or request already decided'),
        },
      },
    },
    '/api/workflow/approvals/{requestId}/steps/{stepId}/reject': {
      post: {
        tags: ['Approvals'],
        summary: 'Reject a step (rejects the whole request)',
        parameters: [idParam('requestId'), idParam('stepId')],
        requestBody: body(obj({ userId: str(), reason: str() }, ['userId', 'reason'])),
        responses: {
          '200': dataResp('Updated step', ref('ApprovalStep')),
          '403': errorResp('Step assigned to a different approver'),
          '404': errorResp('Request or step not found'),
          '409': errorResp('Step or request already decided'),
        },
      },
    },
    '/api/workflow/approvals/{requestId}/cancel': {
      post: {
        tags: ['Approvals'],
        summary: 'Cancel a pending approval request',
        parameters: [idParam('requestId')],
        requestBody: body(obj({ userId: str() }, ['userId'])),
        responses: { '200': { description: 'Cancelled' }, '404': STD_ERRORS['404'], '409': errorResp('Already decided') },
      },
    },
    '/api/workflow/approvals/quote/{quoteId}/status': {
      get: {
        tags: ['Approvals'],
        summary: 'Approval status + progress for a quote',
        parameters: [idParam('quoteId', 'Quote id (UUID)')],
        responses: { '200': dataResp('Approval status', ref('ApprovalStatus')), '404': STD_ERRORS['404'] },
      },
    },
    '/api/workflow/approvals/user/{userId}': {
      get: {
        tags: ['Approvals'],
        summary: 'Pending approval requests assigned to a user',
        parameters: [{ name: 'userId', in: 'path', required: true, schema: str() }],
        responses: { '200': dataResp('Array of approval requests', { type: 'array', items: ref('ApprovalRequest') }) },
      },
    },

    // Payments & Accounts Receivable (M13)
    '/api/invoices/{invoiceId}/payments': {
      get: {
        tags: ['Payments'],
        summary: 'Payment history + balance for an invoice',
        parameters: [idParam('invoiceId', 'Invoice id (UUID)')],
        responses: {
          '200': {
            description: 'Payments and balance summary',
            content: {
              'application/json': {
                schema: obj({
                  data: { type: 'array', items: ref('Payment') },
                  balance: ref('InvoiceBalance'),
                }),
              },
            },
          },
          '404': STD_ERRORS['404'],
        },
      },
      post: {
        tags: ['Payments'],
        summary: 'Record a (possibly partial) payment — editor+',
        parameters: [idParam('invoiceId', 'Invoice id (UUID)'), idempotencyHeader],
        requestBody: body(
          obj(
            {
              amount: num({ description: 'Must be > 0 and ≤ outstanding balance' }),
              method: str({ enum: ['bank_transfer', 'credit_card', 'cash', 'offset'] }),
              paidOn: str({ format: 'date', description: 'Defaults to today' }),
              reference: str({ nullable: true }),
            },
            ['amount', 'method']
          )
        ),
        responses: {
          '201': {
            description: 'Recorded payment + updated balance',
            content: {
              'application/json': {
                schema: obj({ data: ref('Payment'), balance: ref('InvoiceBalance') }),
              },
            },
          },
          '400': errorResp('Validation error'),
          '403': errorResp('Insufficient role or cross-org access'),
          '404': errorResp('Invoice not found'),
          '409': errorResp('Overpayment, or invoice cancelled'),
        },
      },
    },
    '/api/payments': {
      get: {
        tags: ['Payments'],
        summary: 'List payments (org-scoped)',
        parameters: [
          ...pageParams,
          { name: 'invoiceId', in: 'query', schema: str({ format: 'uuid' }) },
          { name: 'status', in: 'query', schema: str({ enum: ['confirmed', 'reversed'] }) },
          { name: 'method', in: 'query', schema: str({ enum: ['bank_transfer', 'credit_card', 'cash', 'offset'] }) },
          { name: 'from', in: 'query', schema: str({ format: 'date' }) },
          { name: 'to', in: 'query', schema: str({ format: 'date' }) },
        ],
        responses: { '200': dataResp('Array of payments', { type: 'array', items: ref('Payment') }) },
      },
    },
    '/api/payments/{id}/reverse': {
      post: {
        tags: ['Payments'],
        summary: 'Reverse a confirmed payment — admin only',
        parameters: [idParam('id', 'Payment id (UUID)')],
        requestBody: body(obj({ reason: str() }, ['reason'])),
        responses: {
          '200': {
            description: 'Reversed payment + updated balance',
            content: {
              'application/json': {
                schema: obj({ data: ref('Payment'), balance: ref('InvoiceBalance') }),
              },
            },
          },
          '400': errorResp('reason is required'),
          '403': errorResp('Admin role required'),
          '404': errorResp('Payment not found'),
          '409': errorResp('Payment already reversed'),
        },
      },
    },
    '/api/reports/accounts-receivable': {
      get: {
        tags: ['Payments'],
        summary: 'Accounts-receivable aging (buckets + per-customer)',
        parameters: [
          { name: 'asOf', in: 'query', required: false, schema: str({ format: 'date' }), description: 'Aging reference date; defaults to today' },
        ],
        responses: {
          '200': dataResp('AR aging report', ref('AccountsReceivable')),
          '400': errorResp('Invalid asOf date'),
        },
      },
    },
  },

  components: {
    schemas: {
      Error: obj({
        error: obj({ code: str(), message: str() }, ['code', 'message']),
      }),
      Organization: obj({
        id: str({ format: 'uuid' }), name: str(), type: str(), parentId: str({ nullable: true }),
        createdAt: str({ format: 'date-time' }),
      }),
      Customer: obj({
        id: str({ format: 'uuid' }), name: str(), address: str({ nullable: true }), phone: str({ nullable: true }),
        createdAt: str({ format: 'date-time' }),
      }),
      Product: obj({
        id: str({ format: 'uuid' }), sku: str(), name: str(), category: str(),
        unitPrice: num(), stockQuantity: { type: 'integer' }, createdAt: str({ format: 'date-time' }),
      }),
      User: obj({
        id: str({ format: 'uuid' }), name: str(), nameEn: str({ nullable: true }), email: str(),
        organizationId: str({ format: 'uuid' }), role: str(), createdAt: str({ format: 'date-time' }),
      }),
      Quote: obj({
        id: str({ format: 'uuid' }), quoteNumber: str(), quoteRequestId: str({ format: 'uuid', nullable: true }),
        customerId: str({ format: 'uuid' }),
        subtotalAmount: num(), taxAmount: num(), totalAmount: num(),
        status: str({ enum: ['draft', 'pending_approval', 'approved', 'rejected', 'invoiced'] }),
        notes: str({ nullable: true }), createdBy: str(),
        createdAt: str({ format: 'date-time' }), updatedAt: str({ format: 'date-time' }),
      }),
      WorkflowStatus: obj({
        quote: ref('Quote'),
        canSubmit: { type: 'boolean' }, canApprove: { type: 'boolean' },
        canReject: { type: 'boolean' }, canInvoice: { type: 'boolean' },
      }),
      ApprovalStep: obj({
        id: str({ format: 'uuid' }), approvalRequestId: str({ format: 'uuid' }),
        stepNumber: { type: 'integer' }, approverUserId: str(),
        status: str({ enum: ['pending', 'approved', 'rejected'] }),
        notes: str({ nullable: true }), decidedAt: str({ format: 'date-time', nullable: true }),
      }),
      ApprovalRequest: obj({
        id: str({ format: 'uuid' }), quoteId: str({ format: 'uuid' }),
        status: str({ enum: ['pending', 'approved', 'rejected', 'cancelled'] }),
        steps: { type: 'array', items: ref('ApprovalStep') },
        createdAt: str({ format: 'date-time' }), completedAt: str({ format: 'date-time', nullable: true }),
      }),
      ApprovalStatus: obj({
        quote: ref('Quote'),
        approvalRequest: { ...ref('ApprovalRequest'), nullable: true },
        progress: obj({
          totalSteps: { type: 'integer' }, completedSteps: { type: 'integer' },
          pendingSteps: { type: 'integer' }, approvalPercentage: { type: 'integer' },
        }),
      }),
      Payment: obj({
        id: str({ format: 'uuid' }), invoiceId: str({ format: 'uuid' }),
        organizationId: str({ format: 'uuid', nullable: true }),
        amount: num(), method: str({ enum: ['bank_transfer', 'credit_card', 'cash', 'offset'] }),
        paidOn: str({ format: 'date' }), reference: str({ nullable: true }),
        status: str({ enum: ['confirmed', 'reversed'] }),
        reversedAt: str({ format: 'date-time', nullable: true }),
        reversalReason: str({ nullable: true }),
        createdBy: str({ nullable: true }), createdAt: str({ format: 'date-time' }),
      }),
      InvoiceBalance: obj({
        invoiceId: str({ format: 'uuid' }),
        totalAmount: num(), paidTotal: num(), outstanding: num(),
        status: str({ enum: ['issued', 'sent', 'partially_paid', 'paid', 'cancelled'] }),
      }),
      AccountsReceivable: obj({
        asOf: str({ format: 'date' }),
        totalOutstanding: num(),
        buckets: obj({
          current: num({ description: '0–30 days past due' }),
          '31-60': num(), '61-90': num(), '90+': num(),
        }),
        byCustomer: {
          type: 'array',
          items: obj({ customerId: str({ format: 'uuid' }), outstanding: num() }),
        },
      }),
    },
  },
};

/** Minimal Swagger UI page that loads the spec from /openapi.json via CDN assets. */
export const swaggerHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>LoopNest Core API — Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
  <style>body { margin: 0 }</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js" crossorigin></script>
  <script>
    window.onload = () => {
      window.ui = SwaggerUIBundle({ url: '/openapi.json', dom_id: '#swagger-ui' });
    };
  </script>
</body>
</html>`;
