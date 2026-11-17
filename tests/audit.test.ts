import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { AuditLogModel } from '../src/modules/audit/audit.model.js';
import { app, createCentre, createUser, signIn, signedInAgent } from './helpers.js';
import request from 'supertest';

describe('audit trail: what is recorded', () => {
  it('an edit stores only the fields that changed, with old and new values', async () => {
    const { agent } = await signedInAgent('superadmin');
    const centre = await agent
      .post('/api/v1/centres')
      .send({ code: 'MDP', name: 'Modipuram', host: 'ICAR-IIFSR', state: 'Uttar Pradesh', city: 'Meerut' })
      .expect(201);
    // `state` is sent unchanged, so only name and city are recorded.
    await agent
      .patch(`/api/v1/centres/${centre.body.data.id}`)
      .send({ name: 'Modipuram PCU', state: 'Uttar Pradesh', city: 'Modipuram' })
      .expect(200);
    const row = await AuditLogModel.findOne({ action: /^Updated centre/ }).lean();
    expect(row?.changes).toEqual({
      name: { from: 'Modipuram', to: 'Modipuram PCU' },
      city: { from: 'Meerut', to: 'Modipuram' },
    });
    expect(String(row?.centreId)).toBe(centre.body.data.id);
  });

  it('records sign-in, failed sign-ins (linked to the account when it exists) and sign-out', async () => {
    const centre = await createCentre();
    const pi = await createUser('pi', centre.id);
    await signIn(pi.email, 'WrongPassword999');
    await signIn('nobody@example.com', 'WrongPassword999');
    const { agent } = await signIn(pi.email);
    await agent.post('/api/v1/auth/logout').expect(204);
    // Signing out without a session still works and records nothing.
    await request(app).post('/api/v1/auth/logout').expect(204);

    const rows = await AuditLogModel.find({ module: 'auth' }).sort({ createdAt: 1, _id: 1 }).lean();
    expect(rows.map((r) => r.action)).toEqual([
      'Failed sign-in: wrong password',
      'Failed sign-in: unknown email',
      'Signed in',
      'Signed out',
    ]);
    expect(String(rows[0]?.userId)).toBe(pi.id);
    expect(String(rows[0]?.centreId)).toBe(centre.id);
    expect(rows[1]).toMatchObject({ userId: null, details: { email: 'nobody@example.com' } });
    expect(rows[2]?.ip).toBeTruthy();
  });
});

describe('audit trail: reading it', () => {
  const seed = async () => {
    const centreA = await createCentre();
    const centreB = await createCentre();
    const { agent: pcu } = await signedInAgent('pc');
    const { agent: piA, user: userA } = await signedInAgent('pi', centreA.id);
    const { agent: piB } = await signedInAgent('pi', centreB.id);
    await pcu.patch(`/api/v1/centres/${centreA.id}`).send({ city: 'Alpha' }).expect(200);
    await pcu.patch(`/api/v1/centres/${centreB.id}`).send({ city: 'Beta' }).expect(200);
    return { centreA, centreB, pcu, piA, piB, userA };
  };

  it('the PCU sees everything; a Centre PI sees only their own centre', async () => {
    const { centreA, pcu, piA } = await seed();
    const all = await pcu.get('/api/v1/audit?limit=100').expect(200);
    const centres = new Set(all.body.data.map((r: { centreId: { id: string } | null }) => r.centreId?.id));
    expect(centres.size).toBeGreaterThanOrEqual(2);

    const mine = await piA.get('/api/v1/audit?limit=100').expect(200);
    expect(mine.body.data.length).toBeGreaterThan(0);
    expect(mine.body.data.every((r: { centreId: { id: string } }) => r.centreId?.id === centreA.id)).toBe(
      true,
    );
    // Asking for another centre returns nothing rather than an error.
    const other = await piA
      .get(
        `/api/v1/audit?centreId=${all.body.data.find((r: { centreId: { id: string } | null }) => r.centreId && r.centreId.id !== centreA.id).centreId.id}`,
      )
      .expect(200);
    expect(other.body.data).toEqual([]);
  });

  it('filters by record, person and text, pages newest first, and validates dates', async () => {
    const { centreA, pcu, userA } = await seed();
    const record = await pcu.get(`/api/v1/audit?entityId=${centreA.id}`).expect(200);
    expect(record.body.data.map((r: { action: string }) => r.action)).toEqual([
      `Updated centre ${centreA.code}`,
    ]);
    expect(record.body.data[0].changes).toEqual({ city: { from: null, to: 'Alpha' } });

    const person = await pcu.get(`/api/v1/audit?userId=${userA.id}`).expect(200);
    expect(person.body.data.every((r: { userId: string }) => r.userId === userA.id)).toBe(true);
    const text = await pcu.get('/api/v1/audit?search=signed%20in').expect(200);
    expect(text.body.data.length).toBeGreaterThanOrEqual(3);

    const page = await pcu.get('/api/v1/audit?limit=2&page=1').expect(200);
    expect(page.body.meta).toMatchObject({ page: 1, limit: 2 });
    const [first, second] = page.body.data;
    expect(new Date(first.createdAt) >= new Date(second.createdAt)).toBe(true);

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const dated = await pcu.get(`/api/v1/audit?from=${today}&to=${today}`).expect(200);
    expect(dated.body.meta.total).toBe(page.body.meta.total);
    await pcu.get('/api/v1/audit?from=01-11-2026').expect(400);
  });

  it('exports the filtered trail to Excel, scoped like the list', async () => {
    const { centreA, piA } = await seed();
    const res = await piA
      .get('/api/v1/audit/export')
      .buffer(true)
      .parse((r, done) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-disposition']).toContain('audit-trail-');
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(res.body as ArrayBuffer);
    const sheet = workbook.worksheets[0]!;
    expect(sheet.getRow(1).getCell(1).value).toBe('When (IST)');
    const centresInFile = new Set<string>();
    sheet.eachRow((row, n) => n > 1 && centresInFile.add(String(row.getCell(4).value)));
    expect([...centresInFile]).toEqual([`${centreA.name} (${centreA.code})`]);
  });
});
