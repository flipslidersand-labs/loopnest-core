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

const JWT_SECRET = process.env.JWT_SECRET || 'loopnest_dev_secret';

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
