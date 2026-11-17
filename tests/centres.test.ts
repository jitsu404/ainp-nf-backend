import { describe, expect, it } from 'vitest';
import { AuditLogModel } from '../src/modules/audit/audit.model.js';
import { CentreModel } from '../src/modules/centres/centres.model.js';
import { createCentre, signedInAgent } from './helpers.js';

const newCentre = { code: 'mdp', name: 'Modipuram', host: 'ICAR-IIFSR', state: 'Uttar Pradesh' };

describe('centres', () => {
  it('lets the Super Admin create a centre and records it in the audit log', async () => {
    const { agent, user } = await signedInAgent('superadmin');
    const res = await agent.post('/api/v1/centres').send(newCentre).expect(201);

    expect(res.body.data).toMatchObject({ code: 'MDP', type: 'Network Centre', isActive: true });
    const audit = await AuditLogModel.findOne({ entityId: res.body.data.id });
    expect(audit).toMatchObject({ module: 'centres', roleId: 'superadmin', userName: user.name });
    expect(audit?.userId?.toString()).toBe(user.id);
  });

  it('lets the PCU create and edit centres', async () => {
    const { agent } = await signedInAgent('pc');
    const res = await agent.post('/api/v1/centres').send(newCentre).expect(201);
    await agent.patch(`/api/v1/centres/${res.body.data.id}`).send({ name: 'Modipuram (IIFSR)' }).expect(200);
  });

  it('forbids a Centre PI from creating or editing centres', async () => {
    const centre = await createCentre();
    const { agent } = await signedInAgent('pi', centre.id);
    const created = await agent.post('/api/v1/centres').send(newCentre).expect(403);
    expect(created.body.error.code).toBe('FORBIDDEN');
    await agent.patch(`/api/v1/centres/${centre.id}`).send({ name: 'Renamed' }).expect(403);
  });

  it('returns 409 for a duplicate centre code', async () => {
    const { agent } = await signedInAgent('superadmin');
    await agent.post('/api/v1/centres').send(newCentre).expect(201);
    const res = await agent
      .post('/api/v1/centres')
      .send({ ...newCentre, name: 'Another' })
      .expect(409);
    expect(res.body.error).toMatchObject({ code: 'DUPLICATE', details: { fields: ['code'] } });
  });

  it('rejects unknown fields and invalid values', async () => {
    const { agent } = await signedInAgent('superadmin');
    const res = await agent
      .post('/api/v1/centres')
      .send({ ...newCentre, type: 'Head Office', isAdmin: true })
      .expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for a malformed id', async () => {
    const { agent } = await signedInAgent('superadmin');
    const res = await agent.get('/api/v1/centres/not-an-id').expect(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('shows national roles every centre, with pagination', async () => {
    await Promise.all([createCentre(), createCentre(), createCentre()]);
    const { agent } = await signedInAgent('pc');
    const res = await agent.get('/api/v1/centres?limit=2&sort=-name').expect(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.meta).toMatchObject({ page: 1, limit: 2, total: 3, pages: 2 });
  });

  it('limits a PI to their own centre, even when asking for another by id', async () => {
    const own = await createCentre();
    const other = await createCentre();
    const { agent } = await signedInAgent('pi', own.id);

    const list = await agent.get('/api/v1/centres').expect(200);
    expect(list.body.data.map((c: { id: string }) => c.id)).toEqual([own.id]);

    await agent.get(`/api/v1/centres/${own.id}`).expect(200);
    await agent.get(`/api/v1/centres/${other.id}`).expect(404);
  });

  it('searches host short name and state too', async () => {
    await CentreModel.create({
      code: 'CBE',
      name: 'Coimbatore',
      host: 'Tamil Nadu Agricultural University',
      hostShort: 'TNAU',
      state: 'Tamil Nadu',
    });
    const { agent } = await signedInAgent('pc');
    for (const q of ['tnau', 'tamil nadu']) {
      const res = await agent.get(`/api/v1/centres?search=${encodeURIComponent(q)}`).expect(200);
      expect(res.body.data.map((x: { code: string }) => x.code)).toEqual(['CBE']);
    }
  });

  it('treats search text literally, not as a regex or query operator', async () => {
    await createCentre({ name: 'Ludhiana' });
    const { agent } = await signedInAgent('superadmin');
    const res = await agent.get('/api/v1/centres?search=.*').expect(200);
    expect(res.body.data).toHaveLength(0);
  });

  it('updates a centre and rejects sorting on fields outside the allowlist', async () => {
    const centre = await createCentre();
    const { agent } = await signedInAgent('superadmin');
    const res = await agent.patch(`/api/v1/centres/${centre.id}`).send({ isActive: false }).expect(200);
    expect(res.body.data.isActive).toBe(false);
    await agent.get('/api/v1/centres?sort=passwordHash').expect(400);
  });
});
