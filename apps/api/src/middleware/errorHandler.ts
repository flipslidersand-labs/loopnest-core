import { Request, Response, NextFunction } from 'express';

export interface ApiError extends Error {
  statusCode?: number;
  code?: string;
}

export class ApiErrorResponse extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string
  ) {
    super(message);
    this.name = 'ApiErrorResponse';
  }
}

export const errorHandler = (
  err: any,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  console.error('Error:', err);

  if (err instanceof ApiErrorResponse) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
      },
    });
  }

  if (err.statusCode) {
    return res.status(err.statusCode).json({
      error: {
        code: err.code || 'INTERNAL_ERROR',
        message: err.message,
      },
    });
  }

  // Prisma validation errors (invalid UUID format, etc.)
  if (err.code === 'P2023') {
    return res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found or invalid ID format',
      },
    });
  }

  // Prisma foreign key constraint violations
  if (err.code === 'P2003') {
    return res.status(400).json({
      error: {
        code: 'INVALID_REFERENCE',
        message: 'Referenced resource does not exist',
      },
    });
  }

  // Prisma unique constraint violations
  if (err.code === 'P2002') {
    return res.status(409).json({
      error: {
        code: 'DUPLICATE_ENTRY',
        message: 'A record with this value already exists',
      },
    });
  }

  // Default error
  res.status(500).json({
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An unexpected error occurred',
    },
  });
};

export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
