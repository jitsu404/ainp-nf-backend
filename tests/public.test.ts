import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { MasterItemModel } from '../src/modules/masters/masters.model.js';
import { app, createCentre, signedInAgent } from './helpers.js';

describe('public summary', () => {
  it('needs no sign-in and shows only Active experiments with how many centres run them', async () => {
    const { agent: pcu } = await signedInAgent('pc');
    await MasterItemModel.create({ type: 'programme', code: 'P2', name: 'Programme 2' });
    const [a, b, c] = await Promise.all([createCentre(), createCentre(), createCentre()]);
    await createCentre().then((x) => x.updateOne({ isActive: false }));
    const base = { programmeCode: 'P2', design: 'RBD', replications: 3, startYear: 2026, endYear: 2029 };

    const running = await pcu
      .post('/api/v1/experiments')
      .send({ ...base, code: 'NF-RUN', title: 'Running experiment', centreIds: [a.id, b.id, c.id] })
      .expect(201);
    await pcu.patch(`/api/v1/experiments/${running.body.data.id}`).send({ status: 'Active' }).expect(200);
    // A withdrawn centre doesn't count.
    await pcu
      .patch(`/api/v1/experiments/${running.body.data.id}`)
      .send({ centreIds: [a.id, b.id] })
      .expect(200);
    // Draft experiments aren't public.
    await pcu
      .post('/api/v1/experiments')
      .send({ ...base, code: 'NF-DRAFT', title: 'Draft experiment', centreIds: [a.id] })
      .expect(201);

    const res = await request(app).get('/api/v1/public/summary').expect(200);
    expect(res.body.data).toEqual({
      centres: 3,
      experiments: [
        {
          code: 'NF-RUN',
          title: 'Running experiment',
          programmeCode: 'P2',
          design: 'RBD',
          startYear: 2026,
          endYear: 2029,
          centres: 2,
        },
      ],
    });
  });
});
