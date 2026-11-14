import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { UserModel } from '../src/modules/users/users.model.js';
import { TEST_PASSWORD, app, createUser, newPerson, signIn, signedInAgent } from './helpers.js';

describe('auth', () => {
  it('signs in, sets an httpOnly cookie and returns the session without the password hash', async () => {
    const user = await createUser('pc');
    const res = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email.toUpperCase(), password: TEST_PASSWORD })
      .expect(200);

    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/nf_session=/);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(res.body.data).toMatchObject({
      user: { id: user.id, email: user.email, roleId: 'pc' },
      role: { id: 'pc', label: 'PCU', scope: 'national' },
      assignableRoles: [{ id: 'pi', label: 'Centre PI' }],
      mustChangePassword: false,
    });
    expect(res.body.data.capabilities).toContain('centres.manage');
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(res.body.data.user._id).toBeUndefined();
  });

  it('gives the same error for a wrong password and an unknown email', async () => {
    const user = await createUser('pc');
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
      .send({ email: 'not-an-email', password: '', role: 'superadmin' })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.body.fieldErrors.email).toBeDefined();
  });

  it('requires a session for /me and returns it with one', async () => {
    await request(app).get('/api/v1/auth/me').expect(401);
    const { agent, user } = await signedInAgent('superadmin');
    const res = await agent.get('/api/v1/auth/me').expect(200);
    expect(res.body.data).toMatchObject({ user: { id: user.id }, role: { id: 'superadmin' } });
  });

  it('rejects a tampered token', async () => {
    const res = await request(app).get('/api/v1/auth/me').set('Cookie', 'nf_session=abc.def.ghi').expect(401);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  it('locks out a user as soon as they are deactivated', async () => {
    const { agent, user } = await signedInAgent('pc');
    await UserModel.updateOne({ _id: user.id }, { isActive: false });
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('clears the cookie on logout', async () => {
    const { agent } = await signedInAgent('pc');
    await agent.post('/api/v1/auth/logout').expect(204);
    await agent.get('/api/v1/auth/me').expect(401);
  });
});

describe('temporary passwords', () => {
  const newPassword = 'MyOwnPassword2026';

  it('blocks everything except /me, change-password and logout until the password is changed', async () => {
    const user = await createUser('pc', null, { mustChangePassword: true });
    const { agent, res } = await signIn(user.email);
    expect(res.body.data.mustChangePassword).toBe(true);

    await agent.get('/api/v1/auth/me').expect(200);
    const blocked = await agent.get('/api/v1/centres').expect(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');

    const changed = await agent
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: TEST_PASSWORD, newPassword })
      .expect(200);
    expect(changed.body.data.mustChangePassword).toBe(false);

    // The fresh cookie from change-password keeps this session working.
    await agent.get('/api/v1/centres').expect(200);
    await signIn(user.email, newPassword).then(({ res: again }) => expect(again.status).toBe(200));
  });

  it('rejects a wrong current password and reusing the same password', async () => {
    const user = await createUser('pc', null, { mustChangePassword: true });
    const { agent } = await signIn(user.email);
    const wrong = await agent
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: 'NotMyPassword1', newPassword })
      .expect(400);
    expect(wrong.body.error.code).toBe('WRONG_PASSWORD');
    const same = await agent
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: TEST_PASSWORD, newPassword: TEST_PASSWORD })
      .expect(400);
    expect(same.body.error.code).toBe('SAME_PASSWORD');
  });

  it('ends existing sessions when a PCU user resets a PI password', async () => {
    const { agent: pcu } = await signedInAgent('superadmin');
    const centre = await pcu.post('/api/v1/centres').send({
      code: 'TMP',
      name: 'Temp',
      host: 'Test University',
      state: 'Punjab',
    });
    const person = newPerson();
    const pi = await pcu.post(`/api/v1/centres/${centre.body.data.id}/pi`).send(person).expect(201);

    const { agent: piAgent } = await signIn(person.email, person.temporaryPassword);
    await piAgent
      .post('/api/v1/auth/change-password')
      .send({ currentPassword: person.temporaryPassword, newPassword })
      .expect(200);
    await piAgent.get('/api/v1/auth/me').expect(200);

    await new Promise((resolve) => setTimeout(resolve, 1100)); // let the clock pass the token's issue second
    await pcu
      .post(`/api/v1/users/${pi.body.data.id}/reset-password`)
      .send({ temporaryPassword: 'AnotherTemp123' })
      .expect(204);
    const expired = await piAgent.get('/api/v1/auth/me').expect(401);
    expect(expired.body.error.code).toBe('SESSION_EXPIRED');
  });
});
