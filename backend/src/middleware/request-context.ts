import type { NextFunction, Request, Response } from 'express';
import { pinoHttp } from 'pino-http';
import { uuid } from '../utils/crypto.js';
import { logger } from '../utils/logger.js';
import { isTest } from '../config/env.js';

/** Attaches a request id, echoed back so a user can quote it in a bug report. */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && incoming.length <= 64 ? incoming : uuid();
  res.setHeader('x-request-id', req.requestId);
  next();
}

export const httpLogger = pinoHttp({
  logger,
  genReqId: (req) => (req as Request).requestId ?? uuid(),
  autoLogging: {
    ignore: (req) => isTest || req.url === '/health' || req.url === '/health/ready',
  },
  customLogLevel: (_req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: (req, res) => `${req.method} ${req.url} -> ${res.statusCode}`,
});
