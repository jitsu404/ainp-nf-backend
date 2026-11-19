import { describe, expect, it } from 'vitest';
import { FinancialYearModel, fyDates } from '../src/modules/financialYears/financialYears.model.js';
import { MasterItemModel } from '../src/modules/masters/masters.model.js';
import { createCentre, newPerson, signIn, signedInAgent } from './helpers.js';

const FY = '2026-27';
const PASSWORD = 'SeatPassword123';

const piBody = (extra: Record<string, unknown> = {}) => {
  const person: Record<string, unknown> = newPerson();
  delete person.temporaryPassword;
  return { ...person, password: PASSWORD, ...extra };
};

const experimentBody = (code: string, extra: Record<string, unknown> = {}) => ({
  code,
  title: `Experiment ${code} on natural farming`,
  programmeCode: 'P2',
  design: 'RBD',
  replications: 3,
  treatments: [
    { code: 'T1', name: 'Control' },
    { code: 'T2', name: 'Natural farming' },
  ],
  seasons: ['KHARIF'],
  startYear: FY,
  ...extra,
});

const setup = async () => {
  await MasterItemModel.insertMany([
    { type: 'season', code: 'KHARIF', name: 'Kharif' },
    { type: 'programme', code: 'P2', name: 'Package of practices' },
  ]);
  await FinancialYearModel.create({ code: FY, ...fyDates(FY), isOpen: true, isCurrent: true });
  const centre = await createCentre();
  const { agent: pcu } = await signedInAgent('pc');
  const { agent: centrePi } = await signedInAgent('pi', centre.id);
  return { pcu, centrePi, centre };
};

describe('Experiment PI accounts', () => {
  it('PCU creates numbered seats that sign in with the password it set', async () => {
    const { pcu } = await setup();
    const first = await pcu.post('/api/v1/experiment-pis').send(piBody()).expect(201);
    const second = await pcu.post('/api/v1/experiment-pis').send(piBody()).expect(201);
    expect(first.body.data.loginEmail).toBe('pi1.npnf@icar.org.in');
    expect(second.body.data.loginEmail).toBe('pi2.npnf@icar.org.in');
    expect(first.body.data).toMatchObject({ seatNumber: 1, experiment: null, isActive: true });

    const { agent, res } = await signIn('pi1.npnf@icar.org.in', PASSWORD);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      role: { id: 'epi', scope: 'experiment' },
      mustChangePassword: false,
    });
    // No forced change: the account works straight away.
    await agent.get('/api/v1/experiments').expect(200);

    const list = await pcu.get('/api/v1/experiment-pis').expect(200);
    expect(list.body.data.map((p: { loginEmail: string }) => p.loginEmail)).toEqual([
      'pi1.npnf@icar.org.in',
      'pi2.npnf@icar.org.in',
    ]);
  });

  it('is limited to the PCU and checks the details', async () => {
    const { pcu, centrePi } = await setup();
    await centrePi.post('/api/v1/experiment-pis').send(piBody()).expect(403);
    await centrePi.get('/api/v1/experiment-pis').expect(403);
    const bad = await pcu
      .post('/api/v1/experiment-pis')
      .send(piBody({ mobile: '12345', password: 'short' }))
      .expect(400);
    expect(Object.keys(bad.body.error.details.body.fieldErrors)).toEqual(
      expect.arrayContaining(['mobile', 'password']),
    );
  });

  it('replacing the holder keeps the login and the experiment, and signs the old holder out', async () => {
    const { pcu } = await setup();
    const seat = await pcu.post('/api/v1/experiment-pis').send(piBody()).expect(201);
    await pcu
      .post('/api/v1/experiments')
      .send(experimentBody('NF-A', { piUserId: seat.body.data.id }))
      .expect(201);
    const { agent: old } = await signIn('pi1.npnf@icar.org.in', PASSWORD);
    await old.get('/api/v1/auth/me').expect(200);
    await new Promise((resolve) => setTimeout(resolve, 1100)); // let the clock pass the token's issue second

    const next = newPerson();
    await pcu
      .post(`/api/v1/experiment-pis/${seat.body.data.id}/replace`)
      .send({ ...piBody({ email: next.email }), password: 'NewHolder12345' })
      .expect(400); // reason required
    const replaced = await pcu
      .post(`/api/v1/experiment-pis/${seat.body.data.id}/replace`)
      .send({ ...piBody({ email: next.email }), password: 'NewHolder12345', reason: 'Retired' })
      .expect(200);
    expect(replaced.body.data).toMatchObject({
      id: seat.body.data.id,
      loginEmail: 'pi1.npnf@icar.org.in',
      email: next.email,
      experiment: { code: 'NF-A' },
    });
    expect(replaced.body.data.history).toHaveLength(1);
    expect(replaced.body.data.history[0]).toMatchObject({ name: seat.body.data.name, reason: 'Retired' });

    expect((await old.get('/api/v1/auth/me').expect(401)).body.error.code).toBe('SESSION_EXPIRED');
    expect((await signIn('pi1.npnf@icar.org.in', 'NewHolder12345')).res.status).toBe(200);
  });

  it('edits the current holder without changing the login', async () => {
    const { pcu } = await setup();
    const seat = await pcu.post('/api/v1/experiment-pis').send(piBody()).expect(201);
    const updated = await pcu
      .patch(`/api/v1/experiment-pis/${seat.body.data.id}`)
      .send({ email: 'new.contact@test.local', designation: 'Principal Scientist' })
      .expect(200);
    expect(updated.body.data).toMatchObject({
      loginEmail: 'pi1.npnf@icar.org.in',
      email: 'new.contact@test.local',
      designation: 'Principal Scientist',
    });
  });
});

describe('Experiment PI on an experiment', () => {
  it('links at creation or later; one experiment per PI', async () => {
    const { pcu } = await setup();
    const seat = await pcu.post('/api/v1/experiment-pis').send(piBody()).expect(201);
    const linked = await pcu
      .post('/api/v1/experiments')
      .send(experimentBody('NF-A', { piUserId: seat.body.data.id }))
      .expect(201);
    expect(linked.body.data.pi).toMatchObject({ id: seat.body.data.id, loginEmail: 'pi1.npnf@icar.org.in' });

    // Optional at creation; the same PI can't lead a second experiment.
    const other = await pcu.post('/api/v1/experiments').send(experimentBody('NF-B')).expect(201);
    expect(other.body.data.pi).toBeNull();
    const taken = await pcu
      .patch(`/api/v1/experiments/${other.body.data.id}`)
      .send({ piUserId: seat.body.data.id })
      .expect(409);
    expect(taken.body.error.code).toBe('PI_ALREADY_LINKED');

    // Unlink from the first, then link to the second.
    await pcu.patch(`/api/v1/experiments/${linked.body.data.id}`).send({ piUserId: null }).expect(200);
    const moved = await pcu
      .patch(`/api/v1/experiments/${other.body.data.id}`)
      .send({ piUserId: seat.body.data.id })
      .expect(200);
    expect(moved.body.data.pi.id).toBe(seat.body.data.id);

    const notAPi = await pcu
      .patch(`/api/v1/experiments/${other.body.data.id}`)
      .send({ piUserId: '0123456789abcdef01234567' })
      .expect(400);
    expect(notAPi.body.error.code).toBe('UNKNOWN_EXPERIMENT_PI');
  });

  it('the Experiment PI sees and edits only their experiment; the PCU assigns centres', async () => {
    const { pcu, centre } = await setup();
    const seat = await pcu.post('/api/v1/experiment-pis').send(piBody()).expect(201);
    const mine = await pcu
      .post('/api/v1/experiments')
      .send(experimentBody('NF-A', { piUserId: seat.body.data.id, centreIds: [centre.id] }))
      .expect(201);
    const others = await pcu
      .post('/api/v1/experiments')
      .send(experimentBody('NF-B', { centreIds: [centre.id] }))
      .expect(201);
    const { agent: epi } = await signIn('pi1.npnf@icar.org.in', PASSWORD);

    const list = await epi.get('/api/v1/experiments').expect(200);
    expect(list.body.data.map((e: { code: string }) => e.code)).toEqual(['NF-A']);
    await epi.get(`/api/v1/experiments/${others.body.data.id}`).expect(404);
    await epi
      .patch(`/api/v1/experiments/${others.body.data.id}`)
      .send({ title: 'Not mine at all' })
      .expect(404);

    // The definition is theirs.
    const edited = await epi
      .patch(`/api/v1/experiments/${mine.body.data.id}`)
      .send({ title: 'Long-term natural farming trial', treatments: [{ code: 'T1', name: 'Control' }] })
      .expect(200);
    expect(edited.body.data.title).toBe('Long-term natural farming trial');

    // Centres, the PI link and new experiments are the PCU's.
    const assign = await epi
      .patch(`/api/v1/experiments/${mine.body.data.id}`)
      .send({ centreIds: [] })
      .expect(403);
    expect(assign.body.error.code).toBe('ASSIGNMENT_NOT_ALLOWED');
    await epi.post('/api/v1/experiments').send(experimentBody('NF-C')).expect(403);

    // They read their experiment's trials, but the centre runs them.
    const trials = await epi.get('/api/v1/trials').expect(200);
    expect(trials.body.data.map((t: { experimentId: { code: string } }) => t.experimentId.code)).toEqual([
      'NF-A',
    ]);
    await epi.patch(`/api/v1/trials/${trials.body.data[0].id}`).send({ layoutNotes: 'x' }).expect(403);
    await epi.get('/api/v1/users').expect(403);
  });
});
