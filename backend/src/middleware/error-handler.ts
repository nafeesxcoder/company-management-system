import type { ErrorRequestHandler, NextFunction, Request, RequestHandler, Response } from 'express';
import { ZodError } from 'zod';
import { isProduction } from '../config/env.js';
import { AppError, isAppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/**
 * Central error handling. Every failure leaves through here in the same shape,
 * and nothing internal (SQL text, stack traces, constraint names) reaches the
 * client in production.
 */

interface PrismaLikeError {
  code?: string;
  meta?: { target?: string[] | string; field_name?: string; modelName?: string };
  name?: string;
}

function mapPrismaError(error: PrismaLikeError): AppError | null {
  switch (error.code) {
    case 'P2002': {
      const target = Array.isArray(error.meta?.target)
        ? error.meta?.target.join(', ')
        : (error.meta?.target ?? 'field');
      return new AppError('CONFLICT', `A record with this ${target} already exists`, 409, {
        details: { constraint: target },
      });
    }
    case 'P2003':
      return new AppError('VALIDATION_ERROR', 'Referenced record does not exist', 400, {
        details: { field: error.meta?.field_name },
      });
    case 'P2025':
      return new AppError('NOT_FOUND', 'Record not found', 404);
    case 'P2000':
      return new AppError('VALIDATION_ERROR', 'A provided value is too long for its column', 400);
    case 'P2034':
      return new AppError('CONFLICT', 'The operation conflicted with another write; please retry', 409);
    case 'P1001':
    case 'P1002':
      return new AppError('INTERNAL_ERROR', 'Database is unreachable', 503, { expose: false });
    default:
      return null;
  }
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} does not exist`,
    },
  });
};

export const errorHandler: ErrorRequestHandler = (
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  let appError: AppError;

  if (isAppError(error)) {
    appError = error;
  } else if (error instanceof ZodError) {
    appError = new AppError('VALIDATION_ERROR', 'Request validation failed', 400, {
      details: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
    });
  } else if (error instanceof SyntaxError && 'body' in error) {
    appError = new AppError('VALIDATION_ERROR', 'Request body is not valid JSON', 400);
  } else {
    const mapped = mapPrismaError(error as PrismaLikeError);
    appError =
      mapped ??
      new AppError('INTERNAL_ERROR', 'An unexpected error occurred', 500, {
        expose: false,
        cause: error,
      });
  }

  const logPayload = {
    err: error,
    requestId: req.requestId,
    method: req.method,
    url: req.originalUrl,
    statusCode: appError.statusCode,
    code: appError.code,
    userId: req.user?.id,
    companyId: req.company?.companyId,
  };

  if (appError.statusCode >= 500) {
    logger.error(logPayload, appError.message);
  } else if (appError.statusCode === 401 || appError.statusCode === 403) {
    logger.warn(logPayload, appError.message);
  } else {
    logger.info(logPayload, appError.message);
  }

  res.status(appError.statusCode).json({
    error: {
      code: appError.code,
      message: appError.expose ? appError.message : 'An unexpected error occurred',
      ...(appError.details ? { details: appError.details } : {}),
      ...(req.requestId ? { requestId: req.requestId } : {}),
      ...(!isProduction && appError.statusCode >= 500 && error instanceof Error
        ? { stack: error.stack }
        : {}),
    },
  });
};
