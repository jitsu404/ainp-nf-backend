import { describe, expect, it } from 'vitest';
import { AuditLogModel } from '../src/modules/audit/audit.model.js';
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
    expect(pi.body.data).toMatchObject({ roleId: 'pi', centreId: centre.id, mustChangePassword: true });
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

    const updated = await agent.patch(`/api/v1/users/${pi.id}`).send({ mobile: '+91-98765-43210' }).expect(200);
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

describe('Centre PI assignment', () => {
  it('assigns a PI to a centre with no PI, and shows them on the centre', async () => {
    const centre = await createCentre();
    const { agent } = await signedInAgent('pc');
    const person = newPerson();
    const res = await agent.post(`/api/v1/centres/${centre.id}/pi`).send(person).expect(201);
    expect(res.body.data).toMatchObject({ roleId: 'pi', centreId: centre.id, email: person.email });

    const detail = await agent.get(`/api/v1/centres/${centre.id}`).expect(200);
    expect(detail.body.data.currentPi).toMatchObject({
      id: res.body.data.id,
      name: `Dr. Person ${person.surname}`,
      mobile: person.mobile,
      organization: person.organization,
    });
    const list = await agent.get('/api/v1/centres').expect(200);
    expect(list.body.data.find((c: { id: string }) => c.id === centre.id).currentPi.email).toBe(person.email);
  });

  it('replaces the current PI in one step, keeping the history', async () => {
    const centre = await createCentre();
    const { agent } = await signedInAgent('superadmin');
    const first = newPerson();
    const second = newPerson();
    const old = await agent.post(`/api/v1/centres/${centre.id}/pi`).send(first).expect(201);

    const noReason = await agent.post(`/api/v1/centres/${centre.id}/pi`).send(second).expect(400);
    expect(noReason.body.error.code).toBe('REASON_REQUIRED');

    const replacement = await agent
      .post(`/api/v1/centres/${centre.id}/pi`)
      .send({ ...second, reason: 'Transferred to another institute' })
      .expect(201);

    const history = await agent.get(`/api/v1/centres/${centre.id}/pis`).expect(200);
    expect(history.body.data.map((u: { id: string; isActive: boolean }) => [u.id, u.isActive])).toEqual([
      [replacement.body.data.id, true],
      [old.body.data.id, false],
    ]);
    expect(history.body.data[1].deactivationReason).toContain('Transferred to another institute');

    // The previous PI can no longer sign in; their audit trail is intact.
    const { res } = await signIn(first.email, first.temporaryPassword);
    expect(res.status).toBe(401);
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
    expect(second.body.data.id).not.toBe(first.body.data.id);
    const reactivate = await agent.post(`/api/v1/users/${first.body.data.id}/activate`).expect(409);
    expect(reactivate.body.error.code).toBe('CENTRE_HAS_PI');
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
