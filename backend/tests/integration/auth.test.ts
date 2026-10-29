import type { Express } from 'express';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { prisma } from '../../src/config/prisma.js';
import { sha256 } from '../../src/utils/crypto.js';
import { EMAILS, PASSWORDS, loginAs, resetDatabase, seedTestCompany } from '../helpers/fixtures.js';

let app: Express;

beforeAll(() => {
  app = createApp();
});

beforeEach(async () => {
  await resetDatabase();
  await seedTestCompany();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('POST /auth/login', () => {
  it('signs in a valid user and returns a session', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAILS.owner, password: PASSWORDS.owner, client: 'mobile' });

    expect(res.status).toBe(200);
    expect(res.body.data.user.email).toBe(EMAILS.owner);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.memberships[0].role).toBe('OWNER');
  });

  it('never returns the password hash', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAILS.owner, password: PASSWORDS.owner, client: 'mobile' });

    expect(JSON.stringify(res.body)).not.toContain('passwordHash');
    expect(JSON.stringify(res.body)).not.toContain('$argon2');
  });

  it('rejects a wrong password with 401', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAILS.owner, password: 'WrongPassword123!', client: 'mobile' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('gives the same error for an unknown email, so accounts cannot be enumerated', async () => {
    const unknown = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.local', password: 'WrongPassword123!', client: 'mobile' });

    const known = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAILS.owner, password: 'WrongPassword123!', client: 'mobile' });

    expect(unknown.status).toBe(known.status);
    expect(unknown.body.error.code).toBe(known.body.error.code);
    expect(unknown.body.error.message).toBe(known.body.error.message);
  });

  it('refuses a disabled account', async () => {
    await prisma.user.update({ where: { email: EMAILS.partner }, data: { isActive: false } });

    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAILS.partner, password: PASSWORDS.partner, client: 'mobile' });

    expect(res.status).toBe(401);
  });

  it('sets an HttpOnly cookie for web clients instead of returning the token', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAILS.owner, password: PASSWORDS.owner, client: 'web' });

    expect(res.status).toBe(200);
    expect(res.body.data.refreshToken).toBeUndefined();

    const cookies = res.headers['set-cookie'] as unknown as string[];
    const refreshCookie = cookies.find((c) => c.startsWith('cms_refresh_token='));
    expect(refreshCookie).toBeDefined();
    expect(refreshCookie).toContain('HttpOnly');
  });

  it('stores only a hash of the refresh token, never the token itself', async () => {
    const session = await loginAs(app, EMAILS.owner, PASSWORDS.owner);

    const raw = await prisma.refreshToken.findFirst({ where: { tokenHash: session.refreshToken } });
    expect(raw).toBeNull();

    const hashed = await prisma.refreshToken.findUnique({
      where: { tokenHash: sha256(session.refreshToken) },
    });
    expect(hashed).not.toBeNull();
  });

  it('records both successful and failed sign-ins in the audit log', async () => {
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAILS.owner, password: PASSWORDS.owner, client: 'mobile' });
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAILS.owner, password: 'nope', client: 'mobile' });

    const actions = (await prisma.auditLog.findMany({ select: { action: true } })).map((a) => a.action);
    expect(actions).toContain('auth.login');
    expect(actions).toContain('auth.login_failed');
  });
});

describe('POST /auth/refresh — rotation and theft detection', () => {
  it('rotates the refresh token on every use', async () => {
    const session = await loginAs(app, EMAILS.owner, PASSWORDS.owner);

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken, client: 'mobile' });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).not.toBe(session.refreshToken);
  });

  it('rejects a replayed token AND revokes the whole family', async () => {
    const session = await loginAs(app, EMAILS.owner, PASSWORDS.owner);

    const rotated = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken, client: 'mobile' });
    const newToken = rotated.body.data.refreshToken as string;

    // The attacker replays the stolen original.
    const replay = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken, client: 'mobile' });
    expect(replay.status).toBe(401);

    // The legitimate user's current token must now be dead too: we cannot tell
    // which party is the thief, so the whole session is burned.
    const afterBreach = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: newToken, client: 'mobile' });
    expect(afterBreach.status).toBe(401);

    const live = await prisma.refreshToken.count({ where: { revokedAt: null } });
    expect(live).toBe(0);
  });

  it('rejects an expired refresh token', async () => {
    const session = await loginAs(app, EMAILS.owner, PASSWORDS.owner);
    await prisma.refreshToken.update({
      where: { tokenHash: sha256(session.refreshToken) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken, client: 'mobile' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects a token that was never issued', async () => {
    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'a'.repeat(96), client: 'mobile' });

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects a refresh for a user disabled since sign-in', async () => {
    const session = await loginAs(app, EMAILS.partner, PASSWORDS.partner);
    await prisma.user.update({ where: { email: EMAILS.partner }, data: { isActive: false } });

    const res = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken, client: 'mobile' });

    expect(res.status).toBe(401);
  });
});

describe('access token enforcement', () => {
  it('rejects an unauthenticated request to a protected route', async () => {
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects a malformed token', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_INVALID');
  });

  it('rejects a token signed with the wrong secret', async () => {
    const jwt = await import('jsonwebtoken');
    const forged = jwt.default.sign({ type: 'access' }, 'an-attacker-chosen-secret-that-is-long', {
      subject: '00000000-0000-0000-0000-000000000000',
      issuer: 'cms-api',
      audience: 'cms-clients',
      expiresIn: 900,
    });

    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
  });

  it('rejects an expired access token', async () => {
    const jwt = await import('jsonwebtoken');
    const expired = jwt.default.sign({ type: 'access' }, process.env.ACCESS_TOKEN_SECRET!, {
      subject: '00000000-0000-0000-0000-000000000000',
      issuer: 'cms-api',
      audience: 'cms-clients',
      expiresIn: -10,
    });

    const res = await request(app).get('/api/v1/auth/me').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('TOKEN_EXPIRED');
  });

  it('rejects a valid token whose user was deactivated', async () => {
    const session = await loginAs(app, EMAILS.partner, PASSWORDS.partner);
    await prisma.user.update({ where: { email: EMAILS.partner }, data: { isActive: false } });

    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`);

    expect(res.status).toBe(401);
  });

  it('returns the profile with memberships for a valid token', async () => {
    const session = await loginAs(app, EMAILS.owner, PASSWORDS.owner);
    const res = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${session.accessToken}`);

    expect(res.status).toBe(200);
    expect(res.body.data.email).toBe(EMAILS.owner);
    expect(res.body.data.memberships).toHaveLength(1);
    expect(res.body.data).not.toHaveProperty('passwordHash');
  });
});

describe('POST /auth/logout', () => {
  it('revokes the presented refresh token', async () => {
    const session = await loginAs(app, EMAILS.owner, PASSWORDS.owner);

    const res = await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ refreshToken: session.refreshToken });
    expect(res.status).toBe(204);

    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken, client: 'mobile' });
    expect(refresh.status).toBe(401);
  });

  it('revokes every session when allDevices is set', async () => {
    const first = await loginAs(app, EMAILS.owner, PASSWORDS.owner);
    const second = await loginAs(app, EMAILS.owner, PASSWORDS.owner);

    await request(app)
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .send({ allDevices: true });

    for (const token of [first.refreshToken, second.refreshToken]) {
      const res = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: token, client: 'mobile' });
      expect(res.status).toBe(401);
    }
  });
});

describe('password management', () => {
  it('changes the password and kills existing sessions', async () => {
    const session = await loginAs(app, EMAILS.partner, PASSWORDS.partner);
    const newPassword = 'BrandNewPassword123!';

    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ currentPassword: PASSWORDS.partner, newPassword });
    expect(res.status).toBe(200);

    // Old refresh token is dead.
    const refresh = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: session.refreshToken, client: 'mobile' });
    expect(refresh.status).toBe(401);

    // Old password no longer works; the new one does.
    const oldLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAILS.partner, password: PASSWORDS.partner, client: 'mobile' });
    expect(oldLogin.status).toBe(401);

    const newLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAILS.partner, password: newPassword, client: 'mobile' });
    expect(newLogin.status).toBe(200);
  });

  it('rejects a password change with the wrong current password', async () => {
    const session = await loginAs(app, EMAILS.partner, PASSWORDS.partner);

    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ currentPassword: 'TotallyWrong123!', newPassword: 'BrandNewPassword123!' });

    expect(res.status).toBe(401);
  });

  it('enforces the password policy', async () => {
    const session = await loginAs(app, EMAILS.partner, PASSWORDS.partner);

    const res = await request(app)
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${session.accessToken}`)
      .send({ currentPassword: PASSWORDS.partner, newPassword: 'short' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('completes a full forgot/reset cycle', async () => {
    const forgot = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: EMAILS.viewer });
    expect(forgot.status).toBe(200);

    const token = forgot.body.data.devResetToken as string;
    expect(token).toBeTruthy();

    const newPassword = 'ResetPassword123!';
    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword });
    expect(reset.status).toBe(200);

    const login = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: EMAILS.viewer, password: newPassword, client: 'mobile' });
    expect(login.status).toBe(200);
  });

  it('does not reveal whether an email exists', async () => {
    const known = await request(app).post('/api/v1/auth/forgot-password').send({ email: EMAILS.viewer });
    const unknown = await request(app)
      .post('/api/v1/auth/forgot-password')
      .send({ email: 'ghost@test.local' });

    expect(known.status).toBe(unknown.status);
    expect(known.body.data.message).toBe(unknown.body.data.message);
  });

  it('refuses a reset token that has expired', async () => {
    const forgot = await request(app).post('/api/v1/auth/forgot-password').send({ email: EMAILS.viewer });
    const token = forgot.body.data.devResetToken as string;

    await prisma.user.update({
      where: { email: EMAILS.viewer },
      data: { resetTokenExpiresAt: new Date(Date.now() - 1000) },
    });

    const reset = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'ResetPassword123!' });

    expect(reset.status).toBe(422);
  });

  it('cannot reuse a reset token twice', async () => {
    const forgot = await request(app).post('/api/v1/auth/forgot-password').send({ email: EMAILS.viewer });
    const token = forgot.body.data.devResetToken as string;

    const first = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'ResetPassword123!' });
    expect(first.status).toBe(200);

    const second = await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token, newPassword: 'AnotherPassword123!' });
    expect(second.status).toBe(422);
  });
});

describe('API surface', () => {
  it('has no public registration endpoint', async () => {
    for (const path of ['/api/v1/auth/register', '/api/v1/auth/signup', '/api/v1/users']) {
      const res = await request(app).post(path).send({ email: 'intruder@test.local', password: 'Whatever123!' });
      expect([404, 401]).toContain(res.status);
    }
  });

  it('returns a consistent error envelope for unknown routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('answers the health probes', async () => {
    expect((await request(app).get('/health')).status).toBe(200);
    expect((await request(app).get('/health/ready')).body.database).toBe('connected');
  });
});
