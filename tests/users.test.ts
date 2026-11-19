import { describe, expect, it } from 'vitest';
import { AuditLogModel } from '../src/modules/audit/audit.model.js';
import { UserModel } from '../src/modules/users/users.model.js';
import { createCentre, createUser, newPerson, signIn, signedInAgent } from './helpers.js';

describe('user accounts', () => {
  it('lets the Super Admin create PCU, Centre PI and Super Admin accounts', async () => {
    const centre = await createCentre();
    const { agent } = await signedInAgent('superadmin');
    await agent
      .post('/api/v1/users')
      .send(newPerson({ roleId: 'pc' }))
      .expect(201);
    await agent
      .post('/api/v1/users')
      .send(newPerson({ roleId: 'superadmin' }))
      .expect(201);
    const pi = await agent
      .post('/api/v1/users')
      .send(newPerson({ roleId: 'pi', centreId: centre.id }))
      .expect(201);
    // Centre PIs are seats: a generated login, and the password the creator set stays.
    expect(pi.body.data).toMatchObject({
      roleId: 'pi',
      centreId: centre.id,
      seatKind: 'centre',
      email: `${centre.code.toLowerCase()}.pi.npnf@icar.org.in`,
      mustChangePassword: false,
    });
    expect(pi.body.data.passwordHash).toBeUndefined();
  });

  it('lets the PCU create Centre PIs only', async () => {
    const centre = await createCentre();
    const { agent } = await signedInAgent('pc');
    await agent
      .post('/api/v1/users')
      .send(newPerson({ roleId: 'pi', centreId: centre.id }))
      .expect(201);
    for (const roleId of ['pc', 'superadmin']) {
      const res = await agent.post('/api/v1/users').send(newPerson({ roleId })).expect(403);
      expect(res.body.error.code).toBe('ROLE_NOT_ASSIGNABLE');
    }
  });

  it('shows the PCU only Centre PI accounts, and hides PCU and Super Admin accounts from them', async () => {
    const centre = await createCentre();
    const otherPcu = await createUser('pc');
    const pi = await createUser('pi', centre.id);
    const { agent } = await signedInAgent('pc');

    const list = await agent.get('/api/v1/users').expect(200);
    expect(list.body.data.map((u: { id: string }) => u.id)).toEqual([pi.id]);
    await agent.get(`/api/v1/users/${otherPcu.id}`).expect(404);
    await agent.post(`/api/v1/users/${otherPcu.id}/deactivate`).send({ reason: 'Testing' }).expect(404);
  });

  it('keeps Centre PIs out of user administration', async () => {
    const centre = await createCentre();
    const { agent } = await signedInAgent('pi', centre.id);
    await agent.get('/api/v1/users').expect(403);
    await agent
      .post('/api/v1/users')
      .send(newPerson({ roleId: 'pi', centreId: centre.id }))
      .expect(403);
  });

  it('requires a centre for a Centre PI and checks it exists', async () => {
    const { agent } = await signedInAgent('pc');
    const missing = await agent
      .post('/api/v1/users')
      .send(newPerson({ roleId: 'pi' }))
      .expect(400);
    expect(missing.body.error.code).toBe('CENTRE_REQUIRED');
    const unknown = await agent
      .post('/api/v1/users')
      .send(newPerson({ roleId: 'pi', centreId: '0123456789abcdef01234567' }))
      .expect(400);
    expect(unknown.body.error.code).toBe('CENTRE_NOT_FOUND');
  });

  it('enforces password strength on temporary passwords', async () => {
    const { agent } = await signedInAgent('superadmin');
    const res = await agent
      .post('/api/v1/users')
      .send(newPerson({ roleId: 'pc', temporaryPassword: 'short' }))
      .expect(400);
    expect(res.body.error.details.body.fieldErrors.temporaryPassword).toBeDefined();
  });

  it('updates details, deactivates with a reason, and reactivates', async () => {
    const centre = await createCentre();
    const pi = await createUser('pi', centre.id);
    const { agent } = await signedInAgent('pc');

    const updated = await agent
      .patch(`/api/v1/users/${pi.id}`)
      .send({ mobile: '+91-98765-43210' })
      .expect(200);
    expect(updated.body.data.mobile).toBe('+91-98765-43210');

    const off = await agent
      .post(`/api/v1/users/${pi.id}/deactivate`)
      .send({ reason: 'On leave' })
      .expect(200);
    expect(off.body.data).toMatchObject({ isActive: false, deactivationReason: 'On leave' });
    const signInBlocked = await signIn(pi.email);
    expect(signInBlocked.res.status).toBe(401);

    const on = await agent.post(`/api/v1/users/${pi.id}/activate`).expect(200);
    expect(on.body.data).toMatchObject({ isActive: true, deactivationReason: null });
  });

  it('stops you deactivating or resetting your own account', async () => {
    const { agent, user } = await signedInAgent('superadmin');
    const res = await agent.post(`/api/v1/users/${user.id}/deactivate`).send({ reason: 'Oops' }).expect(400);
    expect(res.body.error.code).toBe('CANNOT_TARGET_SELF');
    await agent
      .post(`/api/v1/users/${user.id}/reset-password`)
      .send({ temporaryPassword: 'Temporary12345' })
      .expect(400);
  });
});

describe('roles overview', () => {
  it('lists each role with its capabilities and active accounts; Centre PIs cannot see it', async () => {
    const centre = await createCentre();
    const { agent } = await signedInAgent('pc');
    const { agent: pi } = await signedInAgent('pi', centre.id);
    const res = await agent.get('/api/v1/users/roles').expect(200);
    const byId = Object.fromEntries(res.body.data.map((r: { id: string }) => [r.id, r]));
    expect(byId.pc).toMatchObject({
      label: 'PCU',
      scope: 'national',
      activeUsers: 1,
      manages: ['Experiment PI', 'Centre PI'],
    });
    expect(byId.pi.activeUsers).toBe(1);
    expect(byId.pi.capabilities).toContainEqual({
      id: 'research.enter',
      label: 'Enter observation data and set up trials',
      module: 'Research',
    });
    await pi.get('/api/v1/users/roles').expect(403);
  });
});

describe('Centre PI assignment', () => {
  it('assigns a PI to a centre with no PI, and shows them on the centre', async () => {
    const centre = await createCentre();
    const { agent } = await signedInAgent('pc');
    const person = newPerson();
    const res = await agent.post(`/api/v1/centres/${centre.id}/pi`).send(person).expect(201);
    const login = `${centre.code.toLowerCase()}.pi.npnf@icar.org.in`;
    expect(res.body.data).toMatchObject({
      roleId: 'pi',
      centreId: centre.id,
      email: login,
      contactEmail: person.email,
    });
    // The holder signs in with the seat login and the password the PCU set; no forced change.
    const { agent: pi, res: login1 } = await signIn(login, person.temporaryPassword);
    expect(login1.status).toBe(200);
    await pi.get('/api/v1/trials').expect(200);

    const detail = await agent.get(`/api/v1/centres/${centre.id}`).expect(200);
    expect(detail.body.data.currentPi).toMatchObject({
      id: res.body.data.id,
      loginEmail: login,
      email: person.email,
      name: `Dr. Person ${person.surname}`,
      mobile: person.mobile,
      organization: person.organization,
    });
    const list = await agent.get('/api/v1/centres').expect(200);
    expect(list.body.data.find((c: { id: string }) => c.id === centre.id).currentPi.email).toBe(person.email);
  });

  it('replaces the holder of the PI seat in one step, keeping the login and the history', async () => {
    const centre = await createCentre();
    const { agent } = await signedInAgent('superadmin');
    const first = newPerson();
    const second = newPerson({ temporaryPassword: 'SecondPerson123' });
    const old = await agent.post(`/api/v1/centres/${centre.id}/pi`).send(first).expect(201);
    const { agent: oldSession } = await signIn(old.body.data.email, first.temporaryPassword);
    await oldSession.get('/api/v1/auth/me').expect(200);
    await new Promise((resolve) => setTimeout(resolve, 1100)); // let the clock pass the token's issue second

    const noReason = await agent.post(`/api/v1/centres/${centre.id}/pi`).send(second).expect(400);
    expect(noReason.body.error.code).toBe('REASON_REQUIRED');

    const replacement = await agent
      .post(`/api/v1/centres/${centre.id}/pi`)
      .send({ ...second, reason: 'Transferred to another institute' })
      .expect(201);

    // Same account and login; the new holder's details and password.
    expect(replacement.body.data.id).toBe(old.body.data.id);
    expect(replacement.body.data.email).toBe(old.body.data.email);
    expect(replacement.body.data.contactEmail).toBe(second.email);

    const history = await agent.get(`/api/v1/centres/${centre.id}/pis`).expect(200);
    expect(
      history.body.data.map((h: { email: string; isCurrent: boolean; reason: string | null }) => [
        h.email,
        h.isCurrent,
        h.reason,
      ]),
    ).toEqual([
      [second.email, true, null],
      [first.email, false, 'Transferred to another institute'],
    ]);

    // The previous holder's session ends and their password no longer works; the new one's does.
    expect((await oldSession.get('/api/v1/auth/me').expect(401)).body.error.code).toBe('SESSION_EXPIRED');
    expect((await signIn(old.body.data.email, first.temporaryPassword)).res.status).toBe(401);
    expect((await signIn(old.body.data.email, 'SecondPerson123')).res.status).toBe(200);
    expect(await AuditLogModel.countDocuments({ entityId: old.body.data.id })).toBeGreaterThanOrEqual(2);
  });

  it('never allows two active PIs at one centre', async () => {
    const centre = await createCentre();
    const { agent } = await signedInAgent('pc');
    const first = await agent.post(`/api/v1/centres/${centre.id}/pi`).send(newPerson()).expect(201);

    const direct = await agent
      .post('/api/v1/users')
      .send(newPerson({ roleId: 'pi', centreId: centre.id }))
      .expect(409);
    expect(direct.body.error.code).toBe('CENTRE_HAS_PI');

    const second = await agent
      .post(`/api/v1/centres/${centre.id}/pi`)
      .send(newPerson({ reason: 'Replacement' }))
      .expect(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(await UserModel.countDocuments({ centreId: centre.id, roleId: 'pi', isActive: true })).toBe(1);
  });

  it('is limited to the PCU and Super Admin', async () => {
    const centre = await createCentre();
    const { agent } = await signedInAgent('pi', centre.id);
    await agent.post(`/api/v1/centres/${centre.id}/pi`).send(newPerson()).expect(403);
    await agent.get(`/api/v1/centres/${centre.id}/pis`).expect(403);
  });

  it('returns 404 for an unknown centre', async () => {
    const { agent } = await signedInAgent('pc');
    await agent.post('/api/v1/centres/0123456789abcdef01234567/pi').send(newPerson()).expect(404);
  });
});
