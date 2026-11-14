import { describe, expect, it } from 'vitest';
import { ROLE_IDS, type RoleId } from '../src/config/constants.js';
import { createCentre, signedInAgent } from './helpers.js';

let emailCounter = 0;
const newUser = (roleId: RoleId, centreId: string | null = null) => {
  emailCounter += 1;
  return {
    name: 'New Person',
    email: `new${emailCounter}@test.local`,
    password: 'Password1234',
    roleId,
    ...(centreId && { centreId }),
  };
};
const isCentreRole = (role: RoleId) => role === 'pi' || role === 'dataEntry';

describe('users', () => {
  it('lets the PCU assign a PI to a centre', async () => {
    const centre = await createCentre();
    const { agent } = await signedInAgent('pc');
    const res = await agent.post('/api/v1/users').send(newUser('pi', centre.id)).expect(201);
    expect(res.body.data).toMatchObject({ roleId: 'pi', centreId: centre.id });
    expect(res.body.data.passwordHash).toBeUndefined();
  });

  it('lets the Super Administrator create every role, including another Super Administrator', async () => {
    const centre = await createCentre();
    const { agent } = await signedInAgent('superadmin');
    for (const role of ROLE_IDS) {
      await agent
        .post('/api/v1/users')
        .send(newUser(role, isCentreRole(role) ? centre.id : null))
        .expect(201);
    }
  });

  // [actor, roles the actor must NOT be able to create]
  const forbidden: [RoleId, RoleId[]][] = [
    ['pc', ['superadmin', 'pc', 'admin']],
    ['admin', ['superadmin', 'pc', 'admin', 'pi', 'dataEntry']],
  ];
  it.each(forbidden)('stops %s from creating privileged or out-of-scope roles', async (actor, targets) => {
    const centre = await createCentre();
    const { agent } = await signedInAgent(actor);
    for (const role of targets) {
      const res = await agent
        .post('/api/v1/users')
        .send(newUser(role, isCentreRole(role) ? centre.id : null))
        .expect(403);
      expect(res.body.error.code).toBe('ROLE_NOT_ASSIGNABLE');
    }
  });

  it('lets the Administrator create PCU support accounts only', async () => {
    const { agent } = await signedInAgent('admin');
    for (const role of ['reviewer', 'finance', 'adminOfficer'] as const) {
      await agent.post('/api/v1/users').send(newUser(role)).expect(201);
    }
  });

  it.each(['finance', 'adminOfficer', 'reviewer'] as const)(
    'keeps %s out of user administration',
    async (role) => {
      const { agent } = await signedInAgent(role);
      await agent.get('/api/v1/users').expect(403);
      await agent.post('/api/v1/users').send(newUser('reviewer')).expect(403);
    },
  );

  it('requires a centre for centre-level roles', async () => {
    const { agent } = await signedInAgent('pc');
    const res = await agent.post('/api/v1/users').send(newUser('dataEntry')).expect(400);
    expect(res.body.error.code).toBe('CENTRE_REQUIRED');
  });

  it('enforces password strength', async () => {
    const { agent } = await signedInAgent('superadmin');
    const res = await agent
      .post('/api/v1/users')
      .send({ ...newUser('reviewer'), password: 'short' })
      .expect(400);
    expect(res.body.error.details.body.fieldErrors.password).toBeDefined();
  });
});
