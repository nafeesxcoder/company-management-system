import type { MembershipRole } from '../generated/prisma/enums.js';

/**
 * Request-scoped identity. Populated by the authenticate / companyScope
 * middleware — never by anything the client sends.
 */
export interface AuthenticatedUser {
  id: string;
  email: string;
  fullName: string;
  timezone: string;
}

export interface CompanyContext {
  companyId: string;
  role: MembershipRole;
  baseCurrency: string;
  timezone: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      company?: CompanyContext;
      requestId?: string;
      /** Raw body buffer, captured only on webhook routes for signature verification. */
      rawBody?: Buffer;
    }
  }
}

export {};
