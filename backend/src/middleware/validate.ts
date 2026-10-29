import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny, type z } from 'zod';
import { badRequest } from '../utils/errors.js';

/**
 * Request validation. Handlers receive values that have already been parsed and
 * coerced, so nothing downstream has to re-check shapes or types.
 */

export interface ValidationSchemas {
  body?: ZodTypeAny;
  query?: ZodTypeAny;
  params?: ZodTypeAny;
}

function formatZodError(error: ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

export function validate(schemas: ValidationSchemas) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    try {
      if (schemas.params) req.params = schemas.params.parse(req.params) as typeof req.params;
      if (schemas.query) {
        // Express 5 makes req.query a getter; assign onto a writable shadow.
        const parsed = schemas.query.parse(req.query);
        Object.defineProperty(req, 'query', { value: parsed, writable: true, configurable: true });
      }
      if (schemas.body) req.body = schemas.body.parse(req.body);
      next();
    } catch (error) {
      if (error instanceof ZodError) {
        next(badRequest('Request validation failed', formatZodError(error)));
        return;
      }
      next(error);
    }
  };
}

/** Typed helpers so controllers get inference without casts. */
export type Body<T extends ZodTypeAny> = z.infer<T>;
export type Query<T extends ZodTypeAny> = z.infer<T>;
export type Params<T extends ZodTypeAny> = z.infer<T>;
