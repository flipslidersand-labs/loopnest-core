import { Router } from 'express';
import type { RepositoryContainer } from '@loopnest/bizcore-db';
import { requireRole } from '../middleware/auth.js';

export function dunningRuleRoutes(repos: RepositoryContainer): Router {
  const r = Router();

  // GET /api/dunning-rules
  r.get('/', async (req: any, res: any, next: any) => {
    try {
      const activeOnly = req.query.active === 'true';
      const rules = await repos.dunning.findAllRules(activeOnly);
      res.json({ data: rules });
    } catch (err) { next(err); }
  });

  // GET /api/dunning-rules/:id
  r.get('/:id', async (req: any, res: any, next: any) => {
    try {
      const rule = await repos.dunning.findRuleById(req.params.id);
      if (!rule) return res.status(404).json({ error: 'Not found' });
      res.json({ data: rule });
    } catch (err) { next(err); }
  });

  // POST /api/dunning-rules  (admin)
  r.post('/', requireRole('admin'), async (req: any, res: any, next: any) => {
    try {
      const { name, daysOverdue, action, messageTemplate } = req.body;
      if (!name || daysOverdue == null) {
        return res.status(400).json({ error: 'name and daysOverdue are required' });
      }
      if (typeof daysOverdue !== 'number' || daysOverdue < 0) {
        return res.status(400).json({ error: 'daysOverdue must be a non-negative integer' });
      }
      const VALID_ACTIONS = ['reminder', 'warning', 'suspend', 'collection'];
      if (action && !VALID_ACTIONS.includes(action)) {
        return res.status(400).json({ error: `action must be one of: ${VALID_ACTIONS.join(', ')}` });
      }
      const rule = await repos.dunning.createRule({ name, daysOverdue, action, messageTemplate });
      res.status(201).json({ data: rule });
    } catch (err: any) {
      if (err?.code === '23505') return res.status(409).json({ error: 'A rule for this days_overdue + action already exists' });
      next(err);
    }
  });

  // PATCH /api/dunning-rules/:id  (admin)
  r.patch('/:id', requireRole('admin'), async (req: any, res: any, next: any) => {
    try {
      const { name, messageTemplate, isActive } = req.body;
      const updated = await repos.dunning.updateRule(req.params.id, { name, messageTemplate, isActive });
      if (!updated) return res.status(404).json({ error: 'Not found' });
      res.json({ data: updated });
    } catch (err) { next(err); }
  });

  // DELETE /api/dunning-rules/:id  (admin)
  r.delete('/:id', requireRole('admin'), async (req: any, res: any, next: any) => {
    try {
      const deleted = await repos.dunning.deleteRule(req.params.id);
      if (!deleted) return res.status(404).json({ error: 'Not found' });
      res.status(204).send();
    } catch (err) { next(err); }
  });

  return r;
}

export function invoiceDunningRoutes(repos: RepositoryContainer): Router {
  const r = Router({ mergeParams: true });

  // GET /api/invoices/:invoiceId/dunning-logs
  r.get('/', async (req: any, res: any, next: any) => {
    try {
      const logs = await repos.dunning.findLogsByInvoice(req.params.invoiceId);
      res.json({ data: logs });
    } catch (err) { next(err); }
  });

  return r;
}
