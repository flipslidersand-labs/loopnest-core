import { Request, Response, NextFunction } from 'express';
import { verifyToken, type JwtPayload } from '../lib/jwt.js';
import { ApiErrorResponse } from './errorHandler.js';

// Augment Express Request so req.user is typed across the app.
declare global {
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is required');
}

export const authenticate = (req: Request, _res: Response, next: NextFunction): void => {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    return next(new ApiErrorResponse(401, 'UNAUTHORIZED', 'Bearer token required'));
  }
  const token = header.slice(7);
  const payload = verifyToken(token, JWT_SECRET);
  if (!payload) {
    return next(new ApiErrorResponse(401, 'UNAUTHORIZED', 'Invalid or expired token'));
  }
  req.user = payload;
  next();
};

export const requireRole = (...roles: string[]) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(new ApiErrorResponse(401, 'UNAUTHORIZED', 'Authentication required'));
    }
    if (!roles.includes(req.user.role)) {
      return next(
        new ApiErrorResponse(403, 'FORBIDDEN', `Requires role: ${roles.join(' or ')}`)
      );
    }
    next();
  };

/**
 * Get the authenticated user's sub for actor/createdBy fields.
 * Throws 401 instead of silently falling back to "system" — every call site
 * runs behind requireRole/requireCustomer, so a missing req.user here means
 * that guard was skipped, not that the request is legitimately anonymous.
 */
export function getAuthenticatedUserId(req: Request): string {
  if (!req.user?.sub) {
    throw new ApiErrorResponse(401, 'UNAUTHORIZED', 'Authentication required');
  }
  return req.user.sub;
}

export const requireCustomer = (req: Request, _res: Response, next: NextFunction): void => {
  if (!req.user) {
    return next(new ApiErrorResponse(401, 'UNAUTHORIZED', 'Authentication required'));
  }
  if (req.user.role !== 'customer' || !req.user.customerId) {
    return next(new ApiErrorResponse(403, 'FORBIDDEN', 'Customer portal token required'));
  }
  next();
};
