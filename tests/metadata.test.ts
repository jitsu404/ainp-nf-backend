import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { AuditLogModel } from '../src/modules/audit/audit.model.js';
import { FinancialYearModel, fyDates } from '../src/modules/financialYears/financialYears.model.js';
import { MasterItemModel } from '../src/modules/masters/masters.model.js';
import { ParameterModel } from '../src/modules/parameters/parameters.model.js';
import { createCentre, signedInAgent } from './helpers.js';

const FY = '2026-27';
const START_YEAR = 2026; // calendar years; 2026 covers financial year 2026-27
const END_YEAR = 2029;

/** An experiment assigned to centres A and B (each with a PI); centre C has a PI but no trial. */
const setup = async () => {
  await MasterItemModel.insertMany([
    { type: 'season', code: 'KHARIF', name: 'Kharif' },
    { type: 'programme', code: 'P2', name: 'Package of practices' },
    { type: 'crop', code: 'RICE', name: 'Rice', group: 'Cereal' },
    { type: 'unit', code: 'KG_HA', name: 'kg/ha' },
  ]);
  await FinancialYearModel.create({ code: FY, ...fyDates(FY), isOpen: true, isCurrent: true });
  const grain = await ParameterModel.create({
    code: 'GRAIN_YIELD',
    name: 'Grain yield',
    unitCode: 'KG_HA',
    category: 'Yield',
  });
  const centreA = await createCentre({ name: 'Alpha Centre', state: 'Punjab' });
  const centreB = await createCentre({ name: 'Beta Centre' });
  const centreC = await createCentre({ name: 'Gamma Centre' });
  const { agent: pcu } = await signedInAgent('pc');
  const { agent: piA, user: userA } = await signedInAgent('pi', centreA.id);
  const { agent: piB } = await signedInAgent('pi', centreB.id);
  const { agent: piC } = await signedInAgent('pi', centreC.id);
  const experiment = await pcu
    .post('/api/v1/experiments')
    .send({
      code: 'NF-LTE',
      title: 'Long-term evaluation of natural farming',
      programmeCode: 'P2',
      design: 'RBD',
      replications: 3,
      treatments: [
        { code: 'T1', name: 'Control' },
        { code: 'T2', name: 'Complete NF' },
      ],
      defaultParameters: [{ parameterId: grain.id, section: 'Yield', level: 'plot' }],
      seasons: ['KHARIF'],
      startYear: START_YEAR,
      endYear: END_YEAR,
      centreIds: [centreA.id, centreB.id],
    })
    .expect(201);
  const experimentId = experiment.body.data.id as string;
  const trials = await pcu.get(`/api/v1/trials?experimentId=${experimentId}`).expect(200);
  const trialOf = (centreId: string) =>
    trials.body.data.find((t: { centreId: { id: string } }) => t.centreId.id === centreId).id as string;
  await piA
    .patch(`/api/v1/trials/${trialOf(centreA.id)}`)
    .send({
      croppingSystems: [
        {
          croppingSystemId: (
            await pcu
              .post('/api/v1/cropping-systems')
              .send({ seasonCode: 'KHARIF', mainCropCode: 'RICE' })
              .expect(201)
          ).body.data.id,
          crops: [{ cropCode: 'RICE', role: 'main', variety: 'IR 64' }],
        },
      ],
    })
    .expect(200);
  return {
    pcu,
    piA,
    piB,
    piC,
    userA,
    experimentId,
    trialA: trialOf(centreA.id),
    trialB: trialOf(centreB.id),
  };
};

const complete = {
  description: 'Yield of rice under natural farming compared with conventional practice.',
  plotSize: '6 m × 5 m',
  dataFormat: ['Excel', 'Registers'],
  coPis: [{ name: 'Dr. Co Investigator', designation: 'Scientist', email: 'co@test.local' }],
};

const field = (body: { fields: { key: string; display: string }[] }, key: string) =>
  body.fields.find((f) => f.key === key)?.display;

describe('trial metadata', () => {
  it('merges common, automatic and centre fields; the centre saves its own part', async () => {
    const { piA, userA, trialA } = await setup();
    const empty = await piA.get(`/api/v1/metadata/trials/${trialA}`).expect(200);
    expect(empty.body.data.status).toBe('Draft');
    expect(empty.body.data.canEdit).toBe(true);
    expect(field(empty.body.data, 'projectTitle')).toBe('Long-term evaluation of natural farming');
    expect(field(empty.body.data, 'projectCode')).toBe('AINP-NF/NF-LTE');
    expect(field(empty.body.data, 'design')).toBe('RBD, 3 replications, 2 treatments');
    expect(field(empty.body.data, 'commodity')).toBe('Rice');
    expect(field(empty.body.data, 'seasons')).toBe('Kharif');
    expect(field(empty.body.data, 'attributes')).toBe('Grain yield (kg/ha)');
    expect(field(empty.body.data, 'spatialExtent')).toBe('Site-specific: Alpha Centre, Punjab');
    expect(field(empty.body.data, 'piNames')).toBe(userA.name);
    expect(empty.body.data.completeness.missing).toEqual(
      expect.arrayContaining(['Spatial resolution / plot size', 'Available data format']),
    );

    const saved = await piA.put(`/api/v1/metadata/trials/${trialA}`).send(complete).expect(200);
    expect(saved.body.data.completeness.missing).toEqual([]);
    expect(field(saved.body.data, 'piNames')).toBe(`${userA.name}, Dr. Co Investigator`);
    expect(field(saved.body.data, 'piEmails')).toBe(`${userA.email}, co@test.local`);
    expect(field(saved.body.data, 'dataFormat')).toBe('Excel, Registers');

    const audit = await AuditLogModel.findOne({ module: 'metadata' });
    expect(audit?.centreId?.toString()).toBeTruthy();
    expect(Object.keys(audit?.changes ?? {})).toEqual(
      expect.arrayContaining(['description', 'plotSize', 'dataFormat', 'coPis']),
    );
  });

  it('other assigned centres can read but not change it; unassigned centres get 404', async () => {
    const { piA, piB, piC, trialA } = await setup();
    await piA.put(`/api/v1/metadata/trials/${trialA}`).send(complete).expect(200);
    const seen = await piB.get(`/api/v1/metadata/trials/${trialA}`).expect(200);
    expect(seen.body.data.isOwnCentre).toBe(false);
    expect(seen.body.data.canEdit).toBe(false);
    expect(field(seen.body.data, 'plotSize')).toBe('6 m × 5 m');
    await piB.put(`/api/v1/metadata/trials/${trialA}`).send({ plotSize: 'x' }).expect(404);
    await piB.post(`/api/v1/metadata/trials/${trialA}/submit`).send({}).expect(404);
    await piC.get(`/api/v1/metadata/trials/${trialA}`).expect(404);
  });

  it('rejects unknown fields and invalid values', async () => {
    const { piA, trialA } = await setup();
    await piA.put(`/api/v1/metadata/trials/${trialA}`).send({ projectTitle: 'Mine' }).expect(400);
    await piA
      .put(`/api/v1/metadata/trials/${trialA}`)
      .send({ dataFormat: ['Floppy'] })
      .expect(400);
    await piA.put(`/api/v1/metadata/trials/${trialA}`).send({ embargoYears: 50 }).expect(400);
  });

  it('Draft → Submitted → Returned → Submitted → Approved, locked once submitted', async () => {
    const { pcu, piA, trialA } = await setup();
    const incomplete = await piA.post(`/api/v1/metadata/trials/${trialA}/submit`).send({}).expect(400);
    expect(incomplete.body.error.code).toBe('INCOMPLETE_METADATA');

    await piA.put(`/api/v1/metadata/trials/${trialA}`).send(complete).expect(200);
    const submitted = await piA.post(`/api/v1/metadata/trials/${trialA}/submit`).send({}).expect(200);
    expect(submitted.body.data.status).toBe('Submitted');
    expect(submitted.body.data.canEdit).toBe(false);
    const locked = await piA.put(`/api/v1/metadata/trials/${trialA}`).send({ plotSize: '1 ha' }).expect(409);
    expect(locked.body.error.code).toBe('METADATA_LOCKED');

    await piA.post(`/api/v1/metadata/trials/${trialA}/approve`).send({}).expect(403);
    await pcu.post(`/api/v1/metadata/trials/${trialA}/return`).send({}).expect(400);
    await pcu
      .post(`/api/v1/metadata/trials/${trialA}/return`)
      .send({ remark: 'Add the instruments' })
      .expect(200);
    await piA.put(`/api/v1/metadata/trials/${trialA}`).send({ instruments: 'Weighing balance' }).expect(200);
    await piA.post(`/api/v1/metadata/trials/${trialA}/submit`).send({}).expect(200);
    const approved = await pcu.post(`/api/v1/metadata/trials/${trialA}/approve`).send({}).expect(200);
    expect(approved.body.data.status).toBe('Approved');
    expect(approved.body.data.history.map((h: { status: string }) => h.status)).toEqual([
      'Submitted',
      'Returned',
      'Submitted',
      'Approved',
    ]);
    const twice = await pcu.post(`/api/v1/metadata/trials/${trialA}/approve`).send({}).expect(409);
    expect(twice.body.error.code).toBe('INVALID_TRANSITION');
  });
});

describe('experiment metadata', () => {
  it('PCU sets common fields that every centre sees; centres cannot', async () => {
    const { pcu, piA, experimentId, trialB } = await setup();
    await piA.put(`/api/v1/metadata/experiments/${experimentId}/common`).send({ keywords: 'x' }).expect(403);
    await pcu
      .put(`/api/v1/metadata/experiments/${experimentId}/common`)
      .send({ fundingType: 'Lottery' })
      .expect(400);
    const saved = await pcu
      .put(`/api/v1/metadata/experiments/${experimentId}/common`)
      .send({ keywords: 'natural farming, rice', projectCode: 'IIFSR/NF/01' })
      .expect(200);
    const keywords = saved.body.data.common.find((f: { key: string }) => f.key === 'keywords');
    expect(keywords).toMatchObject({ value: 'natural farming, rice', isDefault: false });
    const b = await piA.get(`/api/v1/metadata/trials/${trialB}`).expect(200);
    expect(field(b.body.data, 'projectCode')).toBe('IIFSR/NF/01');

    // Clearing goes back to the default.
    await pcu
      .put(`/api/v1/metadata/experiments/${experimentId}/common`)
      .send({ projectCode: '' })
      .expect(200);
    const again = await piA.get(`/api/v1/metadata/trials/${trialB}`).expect(200);
    expect(field(again.body.data, 'projectCode')).toBe('AINP-NF/NF-LTE');
  });

  it('lists every assigned centre with status and exports the ICAR layout', async () => {
    const { pcu, piA, piB, piC, experimentId, trialA } = await setup();
    await piA.put(`/api/v1/metadata/trials/${trialA}`).send(complete).expect(200);
    await piA.post(`/api/v1/metadata/trials/${trialA}/submit`).send({}).expect(200);

    const overview = await piB.get(`/api/v1/metadata/experiments/${experimentId}`).expect(200);
    expect(overview.body.data.canEditCommon).toBe(false);
    expect(
      overview.body.data.centres.map(
        (c: { centre: { name: string }; status: string; isOwnCentre: boolean }) => [
          c.centre.name,
          c.status,
          c.isOwnCentre,
        ],
      ),
    ).toEqual([
      ['Alpha Centre', 'Submitted', false],
      ['Beta Centre', 'Draft', true],
    ]);
    await piC.get(`/api/v1/metadata/experiments/${experimentId}`).expect(404);

    const file = await pcu
      .get(`/api/v1/metadata/experiments/${experimentId}/export`)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(file.body as ArrayBuffer);
    const sheet = workbook.getWorksheet('Metadata')!;
    const headers = (sheet.getRow(1).values as string[]).filter(Boolean);
    expect(headers).toHaveLength(2 + 37);
    expect(headers[2]).toBe('1. SMD name');
    expect(headers.at(-1)).toBe('38. Resource (data files)');
    expect(headers.some((h) => h.startsWith('19.'))).toBe(false);
    expect(sheet.getRow(2).getCell(1).value).toBe('Alpha Centre');
    expect(sheet.rowCount).toBe(3);
  });
});
