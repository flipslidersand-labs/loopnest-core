import express, { Request, Response } from 'express';
import type { Server } from 'node:http';
import { logger } from './lib/logger.js';
import cors from 'cors';
import { initializeDatabaseServices, redis, setKyselyQueryObserver } from '@loopnest/bizcore-db';
import type { DatabaseServices } from '@loopnest/bizcore-db';
import { ServiceContainer } from './services/index.js';
import { organizationRoutes } from './routes/organizations.js';
import { customerRoutes } from './routes/customers.js';
import { productRoutes } from './routes/products.js';
import { quoteRoutes } from './routes/quotes.js';
import { userRoutes } from './routes/users.js';
import { workflowRoutes } from './routes/workflow.js';
import { invoiceRoutes } from './routes/invoices.js';
import { auditRoutes } from './routes/audit.js';
import { reportRoutes } from './routes/reports.js';
import { webhookRoutes } from './routes/webhooks.js';
import { searchRoutes } from './routes/search.js';
import { memberRoutes } from './routes/members.js';
import { paymentRoutes, invoicePaymentRoutes } from './routes/payments.js';
import { creditNoteRoutes, invoiceCreditNoteRoutes } from './routes/creditNotes.js';
import { taxRateRoutes } from './routes/taxRates.js';
import { quoteTemplateRoutes } from './routes/quoteTemplates.js';
import { recurringContractRoutes } from './routes/recurringContracts.js';
import { dunningRuleRoutes, invoiceDunningRoutes } from './routes/dunning.js';
import { errorHandler } from './middleware/errorHandler.js';
import { authenticate } from './middleware/auth.js';
import { idempotencyMiddleware } from './middleware/idempotency.js';
import { rateLimit } from './middleware/rateLimit.js';
import { requestMetrics } from './middleware/requestMetrics.js';
import { renderMetrics, dbQueryDurationMs } from './observability/metrics.js';
import { openapiDocument, swaggerHtml } from './openapi.js';

const app = express();
const PORT = process.env.PORT || 3000;

const intEnv = (name: string, fallback: number): number => {
  const v = process.env[name];
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

// Rate limits are env-tunable so they can be relaxed for load tests and
// hardened per environment without a code change.
const GLOBAL_RATE_MAX = intEnv('RATE_LIMIT_GLOBAL_MAX', 300);
const WORKFLOW_RATE_MAX = intEnv('RATE_LIMIT_WORKFLOW_MAX', 60);
const RATE_WINDOW_SECONDS = intEnv('RATE_LIMIT_WINDOW_SECONDS', 60);

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database services
let services: DatabaseServices | undefined;
let server: Server | undefined;

initializeDatabaseServices().then((dbServices: DatabaseServices) => {
  services = dbServices;

  // Wire Kysely timing into the metrics histogram.
  setKyselyQueryObserver((kind: string, ms: number) => dbQueryDurationMs.observe(ms, { kind }));

  const serviceContainer = new ServiceContainer(dbServices.repos, dbServices.pgPool, dbServices.kyselyDb);

  // Start EventWorker
  // Interval comes from EVENT_WORKER_INTERVAL_MS (default 5000) inside start().
  serviceContainer.eventWorker.start();
  logger.info('EventWorker started');

  // Observability: correlation id, metrics, structured access log (all routes)
  app.use(requestMetrics({ pgPool: dbServices.pgPool, sampleRate: 0.1 }));

  // Liveness: process is up. Cheap, no dependencies.
  app.get('/health', (req: Request, res: Response) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Readiness: dependencies reachable. Used by orchestrators to gate traffic.
  app.get('/ready', async (req: Request, res: Response) => {
    const checks: Record<string, 'ok' | 'fail'> = { postgres: 'fail', redis: 'fail' };
    await Promise.all([
      dbServices.pgPool
        .query('SELECT 1')
        .then(() => {
          checks.postgres = 'ok';
        })
        .catch(() => undefined),
      redis
        .ping()
        .then(() => {
          checks.redis = 'ok';
        })
        .catch(() => undefined),
    ]);
    const ready = checks.postgres === 'ok' && checks.redis === 'ok';
    res.status(ready ? 200 : 503).json({ ready, checks });
  });

  // Prometheus metrics scrape endpoint.
  app.get('/metrics', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(renderMetrics());
  });

  // API documentation: machine-readable spec + Swagger UI.
  app.get('/openapi.json', (req: Request, res: Response) => {
    res.json(openapiDocument);
  });
  app.get('/docs', (req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(swaggerHtml);
  });

  // Authentication: all /api/* routes require a valid JWT.
  app.use('/api', authenticate);

  // Global rate limit across the API surface
  app.use(
    '/api',
    rateLimit({ bucket: 'global', windowSeconds: RATE_WINDOW_SECONDS, max: GLOBAL_RATE_MAX })
  );

  // Data Access Routes (CRUD operations)
  app.use('/api/organizations', organizationRoutes(dbServices.repos));
  app.use('/api/customers', customerRoutes(dbServices.repos));
  app.use('/api/products', productRoutes(dbServices.repos));
  app.use('/api/quotes', quoteRoutes(dbServices.repos));
  app.use('/api/users', userRoutes(dbServices.repos));
  app.use('/api/invoices', invoiceRoutes(dbServices.repos));
  app.use('/api/audit', auditRoutes(serviceContainer.audit));
  app.use('/api/reports', reportRoutes(serviceContainer.reporting));
  app.use('/api/webhooks', webhookRoutes(serviceContainer.webhooks));
  app.use('/api/search', searchRoutes(serviceContainer.search));
  app.use('/api/organizations/:orgId/members', memberRoutes(dbServices.repos));
  app.use('/api/tax-rates', taxRateRoutes(dbServices.repos));
  app.use('/api/quote-templates', quoteTemplateRoutes(dbServices.repos));

  // Payments & AR (M13) — writes carry idempotency keys, like the workflow routes.
  app.use(
    '/api/invoices/:invoiceId/payments',
    rateLimit({ bucket: 'payments', windowSeconds: RATE_WINDOW_SECONDS, max: WORKFLOW_RATE_MAX }),
    idempotencyMiddleware,
    invoicePaymentRoutes(serviceContainer.payments, dbServices.repos, serviceContainer.webhooks)
  );
  app.use(
    '/api/payments',
    rateLimit({ bucket: 'payments', windowSeconds: RATE_WINDOW_SECONDS, max: WORKFLOW_RATE_MAX }),
    idempotencyMiddleware,
    paymentRoutes(serviceContainer.payments, dbServices.repos, serviceContainer.webhooks)
  );

  // Credit Notes & Refunds (M14)
  app.use(
    '/api/invoices/:invoiceId/credit-notes',
    rateLimit({ bucket: 'credit-notes', windowSeconds: RATE_WINDOW_SECONDS, max: WORKFLOW_RATE_MAX }),
    idempotencyMiddleware,
    invoiceCreditNoteRoutes(serviceContainer.creditNotes, dbServices.repos, serviceContainer.webhooks)
  );
  app.use(
    '/api/credit-notes',
    rateLimit({ bucket: 'credit-notes', windowSeconds: RATE_WINDOW_SECONDS, max: WORKFLOW_RATE_MAX }),
    idempotencyMiddleware,
    creditNoteRoutes(serviceContainer.creditNotes, dbServices.repos, serviceContainer.webhooks)
  );

  app.use('/api/recurring-contracts', recurringContractRoutes(dbServices.repos));
  app.use('/api/dunning-rules', dunningRuleRoutes(dbServices.repos));
  app.use('/api/invoices/:invoiceId/dunning-logs', invoiceDunningRoutes(dbServices.repos));

  // Business Logic Routes (Workflow operations) — tighter limit + idempotency keys
  app.use(
    '/api/workflow',
    rateLimit({ bucket: 'workflow', windowSeconds: RATE_WINDOW_SECONDS, max: WORKFLOW_RATE_MAX }),
    idempotencyMiddleware,
    workflowRoutes(serviceContainer, dbServices.repos)
  );

  // Error handler
  app.use(errorHandler);

  // Start server
  server = app.listen(PORT, () => {
    logger.info({ port: PORT }, 'API server started');
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down');
    serviceContainer.eventWorker.stop();
    if (server) {
      server.close(() => {
        logger.info('server closed');
      });
    }
    await dbServices.close();
    process.exit(0);
  });
});
