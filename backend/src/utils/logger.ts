import { pino, type LoggerOptions } from 'pino';
import { env, isTest } from '../config/env.js';

/**
 * Structured logging. Anything that could carry a secret, a token or a full
 * card/customer payload is redacted before it is written.
 */
const redactPaths = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-api-key"]',
  'req.headers["stripe-signature"]',
  'req.headers["x-razorpay-signature"]',
  'res.headers["set-cookie"]',
  'password',
  'passwordHash',
  '*.password',
  '*.passwordHash',
  'currentPassword',
  'newPassword',
  'accessToken',
  'refreshToken',
  '*.accessToken',
  '*.refreshToken',
  'apiKey',
  'apiKeyCiphertext',
  'webhookSecret',
  'webhookSecretCiphertext',
  'secretKey',
];

const options: LoggerOptions = {
  level: isTest ? 'silent' : env.LOG_LEVEL,
  redact: { paths: redactPaths, censor: '[REDACTED]' },
  base: { service: 'cms-api', env: env.NODE_ENV },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level(label) {
      return { level: label };
    },
  },
};

export const logger = env.LOG_PRETTY
  ? pino({
      ...options,
      transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'SYS:standard' } },
    })
  : pino(options);

export type Logger = typeof logger;
