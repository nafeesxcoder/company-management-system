import type { NextFunction, Request, RequestHandler, Response } from 'express';

/**
 * One response envelope for the whole API, so the web client and the Flutter
 * client can share a single parsing path.
 *
 *   success: { "data": …, "meta": { … } }
 *   failure: { "error": { "code": …, "message": …, "details": … } }
 */

export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface ApiMeta extends Partial<PaginationMeta> {
  [key: string]: unknown;
}

export function ok<T>(res: Response, data: T, meta?: ApiMeta): Response {
  return res.status(200).json(meta ? { data, meta } : { data });
}

export function created<T>(res: Response, data: T, meta?: ApiMeta): Response {
  return res.status(201).json(meta ? { data, meta } : { data });
}

export function noContent(res: Response): Response {
  return res.status(204).send();
}

export function paginated<T>(res: Response, items: T[], meta: PaginationMeta, extra?: ApiMeta): Response {
  return res.status(200).json({ data: items, meta: { ...meta, ...extra } });
}

export function buildPaginationMeta(page: number, pageSize: number, totalItems: number): PaginationMeta {
  const totalPages = pageSize > 0 ? Math.ceil(totalItems / pageSize) : 0;
  return {
    page,
    pageSize,
    totalItems,
    totalPages,
    hasNextPage: page < totalPages,
    hasPreviousPage: page > 1 && totalPages > 0,
  };
}

/** Wraps an async handler so a rejected promise reaches the error middleware. */
export function asyncHandler<
  Req extends Request = Request,
  Res extends Response = Response,
>(fn: (req: Req, res: Res, next: NextFunction) => Promise<unknown>): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req as Req, res as Res, next)).catch(next);
  };
}

export function clientIp(req: Request): string | undefined {
  return req.ip ?? req.socket.remoteAddress ?? undefined;
}

export function userAgent(req: Request): string | undefined {
  const ua = req.get('user-agent');
  return ua ? ua.slice(0, 255) : undefined;
}
