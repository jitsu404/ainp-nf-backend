import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { UserModel } from '../src/modules/users/users.model.js';
import { TEST_PASSWORD, app, createUser, signedInAgent } from './helpers.js';

describe('auth', () => {
  it('signs in, sets an httpOnly cookie and never returns the password hash', async () => {
    const user = await createUser('admin');
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email.toUpperCase(), password: TEST_PASSWORD })
      .expect(200);

    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/nf_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(res.body.data).toMatchObject({ email: user.email, roleId: 'admin' });
    expect(res.body.data.passwordHash).toBeUndefined();
    expect(res.body.data._id).toBeUndefined();
    expect(res.body.data.id).toBe(user.id);
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const user = await createUser('admin');
    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'WrongPassword1' })
      .expect(401);
    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'nobody@test.local', password: 'WrongPassword1' })
      .expect(401);
    expect(wrongPassword.body.error.code).toBe('INVALID_CREDENTIALS');
    expect(unknownEmail.body.error).toMatchObject({
      code: 'INVALID_CREDENTIALS',
      message: wrongPassword.body.error.message,
    });
  });

  it('validates the login DTO, including unknown keys', async () => {
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: '', role: 'admin' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.body.fieldErrors.email).toBeDefined();
  });

  it('requires a session for /me and returns the user with one', async () => {
    await request(app).get('/api/v1/auth/me').expect(401);
    const { agent, user } = await signedInAgent('reviewer');
    const res = await agent.get('/api/v1/auth/me').expect(200);
    expect(res.body.data).toMatchObject({ id: user.id, roleId: 'reviewer' });
  });

  it('rejects a tampered token', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Cookie', 'nf_session=abc.def.ghi').expect(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('locks out a user as soon as they are deactivated', async () => {
    const { agent, user } = await signedInAgent('reviewer');
    await UserModel.updateOne({ _id: user.id }, { isActive: false });
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('clears the cookie on logout', async () => {
    const { agent } = await signedInAgent('reviewer');
    await agent.post('/api/v1/auth/logout').expect(204);
    await agent.get('/api/v1/auth/me').expect(401);
  });
});
