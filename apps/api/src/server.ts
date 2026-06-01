import express from 'express';
import cors from 'cors';
import { initializeDatabaseServices } from '@loopnest/bizcore-db';
import { ServiceContainer } from './services/index.js';
import { organizationRoutes } from './routes/organizations.js';
import { customerRoutes } from './routes/customers.js';
import { productRoutes } from './routes/products.js';
import { quoteRoutes } from './routes/quotes.js';
import { userRoutes } from './routes/users.js';
import { workflowRoutes } from './routes/workflow.js';
import { errorHandler } from './middleware/errorHandler.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Initialize database services
let services: any;
let server: any;

initializeDatabaseServices().then((dbServices: any) => {
  services = dbServices;
  const serviceContainer = new ServiceContainer(dbServices.repos, dbServices.pgPool, dbServices.drizzleDb);

  // Start EventWorker
  serviceContainer.eventWorker.start(5000);
  console.log('🔄 EventWorker started');

  // Health check endpoint
  app.get('/health', (req: any, res: any) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Data Access Routes (CRUD operations)
  app.use('/api/organizations', organizationRoutes(dbServices.repos));
  app.use('/api/customers', customerRoutes(dbServices.repos));
  app.use('/api/products', productRoutes(dbServices.repos));
  app.use('/api/quotes', quoteRoutes(dbServices.repos));
  app.use('/api/users', userRoutes(dbServices.repos));

  // Business Logic Routes (Workflow operations)
  app.use('/api/workflow', workflowRoutes(serviceContainer));

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
