import express from 'express';
import cors from 'cors';
import { initializeDatabaseServices, redis } from '@loopnest/bizcore-db';
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
import { errorHandler } from './middleware/errorHandler.js';
import { authenticate } from './middleware/auth.js';
import { idempotencyMiddleware } from './middleware/idempotency.js';
import { rateLimit } from './middleware/rateLimit.js';
import { requestMetrics } from './middleware/requestMetrics.js';
import { renderMetrics } from './observability/metrics.js';
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
let services: any;
let server: any;

initializeDatabaseServices().then((dbServices: any) => {
  services = dbServices;
  const serviceContainer = new ServiceContainer(dbServices.repos, dbServices.pgPool, dbServices.kyselyDb);

  // Start EventWorker
  // Interval comes from EVENT_WORKER_INTERVAL_MS (default 5000) inside start().
  serviceContainer.eventWorker.start();
  console.log('🔄 EventWorker started');

  // Observability: correlation id, metrics, structured access log (all routes)
  app.use(requestMetrics({ pgPool: dbServices.pgPool, sampleRate: 0.1 }));

  // Liveness: process is up. Cheap, no dependencies.
  app.get('/health', (req: any, res: any) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Readiness: dependencies reachable. Used by orchestrators to gate traffic.
  app.get('/ready', async (req: any, res: any) => {
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
  app.get('/metrics', (req: any, res: any) => {
    res.setHeader('Content-Type', 'text/plain; version=0.0.4');
    res.send(renderMetrics());
  });

  // API documentation: machine-readable spec + Swagger UI.
  app.get('/openapi.json', (req: any, res: any) => {
    res.json(openapiDocument);
  });
  app.get('/docs', (req: any, res: any) => {
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
    console.log(`🚀 API Server running on http://localhost:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('SIGTERM received, shutting down...');
    serviceContainer.eventWorker.stop();
    if (server) {
      server.close(() => {
        console.log('Server closed');
      });
    }
    await dbServices.close();
    process.exit(0);
  });
});
